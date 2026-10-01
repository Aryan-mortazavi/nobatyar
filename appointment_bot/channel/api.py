"""
🌐 Channel client — the bridge to the NobatYar web application.

The web app is the single source of truth for the calendar. This bot is a
*channel*: it owns no database, no availability logic and no business rules. It
asks the app what is true (catalogue, free slots, my appointments), renders the
answer as Telegram keyboards, and sends the customer's choice back.

Why this matters
----------------
Two systems that each keep their own calendar will eventually disagree, and the
disagreement shows up as a double booking. One owner, one engine, one set of
rules — the bot only speaks HTTP.

Credentials
-----------
Two, always together (see the web app's ``src/lib/channel-auth.ts``):

    Authorization: Bearer <CHANNEL_API_SECRET>   "I am the bot"
    X-Customer-Token: <jwt>                      "…and this is the customer"

The customer token is minted by ``/api/v1/customers/identify`` the first time a
person gives their name and mobile number, and is kept in the FSM state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(12.0, connect=5.0)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class ChannelError(Exception):
    """
    Any failure while talking to the web app.

    ``code`` is the machine-readable error the API returned
    (``SLOT_TAKEN``, ``NOT_FOUND``, ``RATE_LIMITED``…), so the handlers can pick
    the right sentence instead of showing a raw HTTP status.
    """

    def __init__(self, code: str, message: str, status: int = 0, details: dict[str, Any] | None = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}

    @property
    def slot_taken(self) -> bool:
        return self.code == "SLOT_TAKEN"

    @property
    def rate_limited(self) -> bool:
        return self.code == "RATE_LIMITED"


class ChannelUnavailable(ChannelError):
    """The web app could not be reached at all (wrong URL, server down…)."""

    def __init__(self, message: str = "the booking service is unreachable"):
        super().__init__("UNAVAILABLE", message)


# ---------------------------------------------------------------------------
# Views (typed, so a handler never pokes at raw dicts)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Workspace:
    id: str
    title: str
    name: str
    phone: str | None
    address: str | None
    timezone: str
    currency: str
    web_url: str = ""


@dataclass(frozen=True)
class Service:
    id: str
    title: str
    duration_min: int
    price: int | None
    staff_ids: tuple[str, ...]
    category: str | None
    web_url: str


@dataclass(frozen=True)
class Staff:
    id: str
    name: str
    title: str | None
    service_ids: tuple[str, ...]


@dataclass(frozen=True)
class Location:
    id: str
    title: str
    address: str | None


@dataclass(frozen=True)
class Catalogue:
    workspace: Workspace
    services: tuple[Service, ...]
    staff: tuple[Staff, ...]
    locations: tuple[Location, ...]
    labels: dict[str, str] = field(default_factory=dict)

    def service(self, service_id: str) -> Service | None:
        return next((item for item in self.services if item.id == service_id), None)

    def staff_for(self, service_id: str) -> tuple[Staff, ...]:
        """Specialists who can take this service, in catalogue order."""
        return tuple(item for item in self.staff if service_id in item.service_ids)

    def label(self, key: str, fallback: str = "") -> str:
        return self.labels.get(key) or fallback


@dataclass(frozen=True)
class Slot:
    start: int  # epoch milliseconds, exactly as the web app uses
    label: str
    available: bool
    reason: str | None = None


@dataclass(frozen=True)
class DayAvailability:
    slots: tuple[Slot, ...]

    @property
    def free(self) -> tuple[Slot, ...]:
        return tuple(slot for slot in self.slots if slot.available)

    @property
    def has_free(self) -> bool:
        return bool(self.free)


@dataclass(frozen=True)
class DaySummary:
    date: str
    bookable: bool
    free_count: int
    is_holiday: bool
    is_closed: bool


@dataclass(frozen=True)
class Appointment:
    tracking_code: str
    status: str
    status_label: str
    is_upcoming: bool
    cancellable: bool
    service_title: str
    staff_name: str
    when_text: str
    when_iso: str
    location_title: str | None
    used_package_session: bool
    web_url: str
    series_index: int | None = None

    @property
    def active(self) -> bool:
        return self.status in {"PENDING", "CONFIRMED"}


@dataclass(frozen=True)
class Booking:
    count: int
    tracking_code: str | None
    message: str
    appointments: tuple[Appointment, ...]


@dataclass(frozen=True)
class PackageLine:
    service_id: str
    title: str
    quantity: int
    remaining: int


@dataclass(frozen=True)
class CustomerPackage:
    id: str
    name: str
    total_sessions: int
    used_sessions: int
    remaining_sessions: int
    expires_at: str
    lines: tuple[PackageLine, ...] = ()


@dataclass(frozen=True)
class Customer:
    id: str
    name: str
    phone: str | None
    token: str
    telegram_id: str
    welcome: str = ""


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------
class ChannelApi:
    """
    Thin async client over the web app's ``/api/v1`` API.

    One instance per bot process. It holds the channel secret and can mint
    customer tokens; the token itself is passed per call by the handler that
    owns the conversation.
    """

    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        channel: str = "telegram",
        timeout: httpx.Timeout | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not base_url:
            raise ValueError("WEB_API_URL is required")
        if not secret or len(secret) < 24:
            raise ValueError("CHANNEL_API_SECRET is required (24+ characters)")
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.channel = channel
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout or DEFAULT_TIMEOUT,
            transport=transport,
            headers={"User-Agent": "nobatyar-telegram-bot/2.0"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "ChannelApi":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    # -- plumbing ----------------------------------------------------------
    async def _request(
        self,
        method: str,
        path: str,
        *,
        customer_token: str | None = None,
        telegram_id: str | int | None = None,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "X-Channel": self.channel,
            "Accept": "application/json",
        }
        if customer_token:
            headers["X-Customer-Token"] = customer_token
        if telegram_id is not None:
            headers["X-Telegram-Id"] = str(telegram_id)

        url = f"/api/v1{path}"
        try:
            response = await self._client.request(
                method, url, json=json, params=params, headers=headers
            )
        except httpx.HTTPError as exc:  # network, timeout, DNS…
            logger.warning("channel request failed (%s %s): %s", method, url, exc)
            raise ChannelUnavailable() from exc

        try:
            payload = response.json()
        except ValueError:
            payload = {}

        if response.status_code >= 400:
            error = payload.get("error") if isinstance(payload, dict) else None
            code = (error or {}).get("code", f"HTTP_{response.status_code}")
            message = (error or {}).get("message", response.text[:200])
            details = {k: v for k, v in (error or {}).items() if k not in {"code", "message"}}
            raise ChannelError(code=code, message=message, status=response.status_code, details=details)

        if not isinstance(payload, dict):
            raise ChannelError("BAD_RESPONSE", "unexpected payload from the booking service")
        return payload

    @staticmethod
    def _data(payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("data")
        return data if isinstance(data, dict) else {}

    # -- health ------------------------------------------------------------
    async def health(self) -> bool:
        """True when the web app answers — called once at start-up."""
        try:
            response = await self._client.get("/api/health", timeout=httpx.Timeout(5.0))
            return response.status_code == 200
        except httpx.HTTPError:
            return False

    # -- catalogue ---------------------------------------------------------
    async def catalogue(self, locale: str = "fa") -> Catalogue:
        payload = await self._request("GET", "/catalogue", params={"locale": locale})
        data = self._data(payload)
        workspace = data.get("workspace") or {}
        return Catalogue(
            workspace=Workspace(
                id=workspace.get("id", ""),
                title=workspace.get("title") or workspace.get("name", ""),
                name=workspace.get("name", ""),
                phone=workspace.get("phone"),
                address=workspace.get("address"),
                timezone=workspace.get("timezone", "Asia/Tehran"),
                currency=workspace.get("currency", "IRT"),
            ),
            services=tuple(
                Service(
                    id=item["id"],
                    title=item.get("title") or item.get("name", ""),
                    duration_min=int(item.get("durationMin") or 30),
                    price=item.get("price"),
                    staff_ids=tuple(item.get("staffIds") or ()),
                    category=(item.get("category") or {}).get("title"),
                    web_url=item.get("webUrl", ""),
                )
                for item in data.get("services") or ()
            ),
            staff=tuple(
                Staff(
                    id=item["id"],
                    name=item.get("name", ""),
                    title=item.get("title"),
                    service_ids=tuple(item.get("serviceIds") or ()),
                )
                for item in data.get("staff") or ()
            ),
            locations=tuple(
                Location(
                    id=item["id"],
                    title=item.get("title") or item.get("name", ""),
                    address=item.get("address"),
                )
                for item in data.get("locations") or ()
            ),
            labels=dict(data.get("labels") or {}),
        )

    # -- identity ----------------------------------------------------------
    async def identify(
        self,
        *,
        telegram_id: str | int,
        name: str,
        phone: str,
        telegram_username: str | None = None,
        locale: str = "fa",
    ) -> Customer:
        payload = await self._request(
            "POST",
            "/customers/identify",
            json={
                "telegramId": str(telegram_id),
                "telegramUsername": telegram_username or "",
                "name": name,
                "phone": phone,
                "locale": locale,
            },
        )
        data = self._data(payload)
        customer = data.get("customer") or {}
        return Customer(
            id=customer.get("id", ""),
            name=customer.get("name") or name,
            phone=customer.get("phone"),
            token=data.get("token", ""),
            telegram_id=str(telegram_id),
            welcome=data.get("welcome", ""),
        )

    # -- availability ------------------------------------------------------
    async def availability_days(
        self,
        *,
        service_id: str,
        staff_id: str | None = None,
        location_id: str | None = None,
        days: int = 30,
        locale: str = "fa",
    ) -> list[DaySummary]:
        params: dict[str, Any] = {"serviceId": service_id, "days": days, "locale": locale}
        if staff_id:
            params["staffId"] = staff_id
        if location_id:
            params["locationId"] = location_id
        payload = await self._request("GET", "/availability", params=params)
        return [
            DaySummary(
                date=item["date"],
                bookable=bool(item.get("bookable")),
                free_count=int(item.get("freeCount") or 0),
                is_holiday=bool(item.get("isHoliday")),
                is_closed=bool(item.get("isClosed")),
            )
            for item in self._data(payload).get("days") or ()
        ]

    async def availability_day(
        self,
        *,
        service_id: str,
        date: str,
        staff_id: str | None = None,
        location_id: str | None = None,
        locale: str = "fa",
    ) -> DayAvailability:
        params: dict[str, Any] = {"serviceId": service_id, "date": date, "locale": locale}
        if staff_id:
            params["staffId"] = staff_id
        if location_id:
            params["locationId"] = location_id
        payload = await self._request("GET", "/availability", params=params)
        return DayAvailability(
            slots=tuple(
                Slot(
                    start=int(item["start"]),
                    label=item.get("label", ""),
                    available=bool(item.get("available")),
                    reason=item.get("reason"),
                )
                for item in self._data(payload).get("slots") or ()
            )
        )

    # -- booking -----------------------------------------------------------
    async def book(
        self,
        *,
        customer_token: str,
        telegram_id: str | int,
        service_id: str,
        slot: int,
        staff_id: str | None = None,
        location_id: str | None = None,
        notes: str | None = None,
        repeat_count: int = 1,
        package_purchase_id: str | None = None,
        locale: str = "fa",
    ) -> Booking:
        body: dict[str, Any] = {
            "serviceId": service_id,
            "slot": slot,
            "repeatCount": repeat_count,
            "locale": locale,
        }
        if staff_id:
            body["staffId"] = staff_id
        if location_id:
            body["locationId"] = location_id
        if notes:
            body["notes"] = notes
        if package_purchase_id:
            body["packagePurchaseId"] = package_purchase_id

        payload = await self._request(
            "POST",
            "/appointments",
            customer_token=customer_token,
            telegram_id=telegram_id,
            json=body,
        )
        data = self._data(payload)
        return Booking(
            count=int(data.get("count") or 0),
            tracking_code=data.get("trackingCode"),
            message=data.get("message", ""),
            appointments=tuple(_appointment(item) for item in data.get("appointments") or ()),
        )

    # -- appointments ------------------------------------------------------
    async def my_appointments(
        self,
        *,
        customer_token: str,
        telegram_id: str | int,
        scope: str = "upcoming",
        locale: str = "fa",
    ) -> list[Appointment]:
        payload = await self._request(
            "GET",
            "/appointments",
            customer_token=customer_token,
            telegram_id=telegram_id,
            params={"scope": scope, "locale": locale},
        )
        return [_appointment(item) for item in self._data(payload).get("appointments") or ()]

    async def cancel(
        self,
        *,
        customer_token: str,
        telegram_id: str | int,
        tracking_code: str,
        whole_series: bool = False,
        locale: str = "fa",
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"locale": locale}
        if whole_series:
            params["series"] = "1"
        payload = await self._request(
            "POST",
            f"/appointments/{tracking_code}/cancel",
            customer_token=customer_token,
            telegram_id=telegram_id,
            params=params,
        )
        return self._data(payload)

    # -- packages / waitlist / support ------------------------------------
    async def packages(
        self, *, customer_token: str, telegram_id: str | int, locale: str = "fa"
    ) -> list[CustomerPackage]:
        payload = await self._request(
            "GET",
            "/packages",
            customer_token=customer_token,
            telegram_id=telegram_id,
            params={"locale": locale},
        )
        return [
            CustomerPackage(
                id=item["id"],
                name=item.get("name", ""),
                total_sessions=int(item.get("totalSessions") or 0),
                used_sessions=int(item.get("usedSessions") or 0),
                remaining_sessions=int(item.get("remainingSessions") or 0),
                expires_at=item.get("expiresAt", ""),
                lines=tuple(
                    PackageLine(
                        service_id=line.get("serviceId", ""),
                        title=line.get("title", ""),
                        quantity=int(line.get("quantity") or 0),
                        remaining=int(line.get("remaining") or 0),
                    )
                    for line in item.get("lines") or ()
                ),
            )
            for item in self._data(payload).get("packages") or ()
        ]

    async def remaining_for(
        self, *, customer_token: str, telegram_id: str | int, service_id: str, locale: str = "fa"
    ) -> int:
        """Sessions of this service the customer may still spend (0 if none)."""
        packages = await self.packages(
            customer_token=customer_token, telegram_id=telegram_id, locale=locale
        )
        for package in packages:
            for line in package.lines:
                if line.service_id == service_id:
                    return line.remaining
        return 0

    async def join_waitlist(
        self,
        *,
        customer_token: str,
        telegram_id: str | int,
        service_id: str,
        date: str,
        staff_id: str | None = None,
        preferred_start_minute: int | None = None,
        locale: str = "fa",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"serviceId": service_id, "date": date, "locale": locale}
        if staff_id:
            body["staffId"] = staff_id
        if preferred_start_minute is not None:
            body["preferredStartMinute"] = preferred_start_minute
        payload = await self._request(
            "POST",
            "/waitlist",
            customer_token=customer_token,
            telegram_id=telegram_id,
            json=body,
        )
        return self._data(payload)

    async def send_support(
        self,
        *,
        customer_token: str,
        telegram_id: str | int,
        message: str,
        locale: str = "fa",
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/support",
            customer_token=customer_token,
            telegram_id=telegram_id,
            json={"message": message, "locale": locale},
        )
        return self._data(payload)


def _appointment(item: dict[str, Any]) -> Appointment:
    when = item.get("when") or {}
    series = item.get("series") or {}
    service = item.get("service") or {}
    staff = item.get("staff") or {}
    location = item.get("location") or {}
    return Appointment(
        tracking_code=item.get("trackingCode", ""),
        status=item.get("status", ""),
        status_label=item.get("statusLabel", item.get("status", "")),
        is_upcoming=bool(item.get("isUpcoming")),
        cancellable=bool(item.get("cancellable")),
        service_title=service.get("title", ""),
        staff_name=staff.get("name", ""),
        when_text=when.get("date", ""),
        when_iso=when.get("startsAt", ""),
        location_title=location.get("title") or None,
        used_package_session=bool(item.get("usedPackageSession")),
        web_url=item.get("webUrl", ""),
        series_index=int(series["index"]) if series.get("index") else None,
    )


def group_by_date(appointments: Iterable[Appointment]) -> list[tuple[str, list[Appointment]]]:
    """Group appointments under their ``when.date`` label, preserving order."""
    grouped: dict[str, list[Appointment]] = {}
    for appointment in appointments:
        grouped.setdefault(appointment.when_text, []).append(appointment)
    return list(grouped.items())


__all__ = [
    "ChannelApi",
    "ChannelError",
    "ChannelUnavailable",
    "Catalogue",
    "Customer",
    "CustomerPackage",
    "DayAvailability",
    "DaySummary",
    "PackageLine",
    "Booking",
    "Appointment",
    "Slot",
    "Service",
    "Staff",
    "Location",
    "Workspace",
    "group_by_date",
]
