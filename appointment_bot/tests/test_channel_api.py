"""
Tests for the channel bridge.

Two layers, deliberately:

* **unit** — the client is wired to a mock transport, so every request shape,
  error mapping and parser is checked without a server. Fast, always runs.
* **live** — ``test_live_channel.py`` runs the real flow against a real web app
  and is skipped unless ``CHANNEL_API_URL`` is set. That is the test that proves
  the two projects actually fit together.

Nothing here touches a database: the bot has none.
"""

from __future__ import annotations

import json

import httpx
import pytest

from channel.api import ChannelApi, ChannelError, ChannelUnavailable, group_by_date

SECRET = "s" * 43  # the client refuses anything shorter


def api_with(handler) -> ChannelApi:
    """A client whose HTTP layer is replaced by ``handler``."""
    return ChannelApi(
        "http://web.test",
        SECRET,
        transport=httpx.MockTransport(handler),
    )


def json_response(payload: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=payload)


# ---------------------------------------------------------------------------
# Construction & health
# ---------------------------------------------------------------------------
def test_requires_a_secret() -> None:
    with pytest.raises(ValueError):
        ChannelApi("http://web.test", "")


def test_requires_a_url() -> None:
    with pytest.raises(ValueError):
        ChannelApi("", SECRET)


@pytest.mark.asyncio
async def test_health_true_when_the_web_app_answers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/health"
        return json_response({"status": "ok"})

    client = api_with(handler)
    assert await client.health() is True
    await client.aclose()


@pytest.mark.asyncio
async def test_health_false_when_down() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = api_with(handler)
    assert await client.health() is False
    await client.aclose()


# ---------------------------------------------------------------------------
# The channel credential is always presented
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_every_call_presents_the_channel_secret() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        seen["channel"] = request.headers.get("x-channel", "")
        return json_response({"ok": True, "data": {"workspace": {"name": "x"}}})

    client = api_with(handler)
    await client.catalogue()
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["channel"] == "telegram"
    await client.aclose()


@pytest.mark.asyncio
async def test_customer_token_is_never_mixed_into_the_channel_credential() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        seen["customer"] = request.headers.get("x-customer-token", "")
        return json_response({"ok": True, "data": {"appointments": []}})

    client = api_with(handler)
    await client.my_appointments(customer_token="jwt-abc", telegram_id=42)
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["customer"] == "jwt-abc"
    await client.aclose()


# ---------------------------------------------------------------------------
# Catalogue parsing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_catalogue_is_parsed_into_typed_views() -> None:
    payload = {
        "ok": True,
        "data": {
            "workspace": {
                "id": "w1",
                "name": "Aria",
                "nameFa": "آریا",
                "title": "آریا",
                "phone": "021111",
                "address": "تهران",
                "timezone": "Asia/Tehran",
                "currency": "IRT",
            },
            "services": [
                {
                    "id": "s1",
                    "name": "Facial",
                    "nameFa": "پاکسازی",
                    "title": "پاکسازی",
                    "durationMin": 60,
                    "price": 2_400_000,
                    "staffIds": ["st1", "st2"],
                    "category": {"slug": "skin", "title": "پوست"},
                    "webUrl": "http://web.test/fa/book?service=s1",
                }
            ],
            "staff": [
                {"id": "st1", "name": "مهسا", "title": None, "serviceIds": ["s1"]},
                {"id": "st2", "name": "سارا", "title": "پزشک", "serviceIds": ["s2"]},
            ],
            "locations": [{"id": "l1", "name": "ونک", "title": "ونک", "address": "…" }],
            "labels": {"book": "🗓 رزرو نوبت جدید"},
        },
    }

    client = api_with(lambda request: json_response(payload))
    catalogue = await client.catalogue()

    assert catalogue.workspace.title == "آریا"
    assert catalogue.workspace.currency == "IRT"
    assert catalogue.service("s1") is not None
    assert catalogue.service("nope") is None
    # only the specialist who actually offers the service
    assert [member.name for member in catalogue.staff_for("s1")] == ["مهسا"]
    assert catalogue.label("book") == "🗓 رزرو نوبت جدید"
    assert catalogue.label("missing", "fallback") == "fallback"
    assert catalogue.locations[0].title == "ونک"
    await client.aclose()


# ---------------------------------------------------------------------------
# Identification
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_identify_sends_the_phone_untouched() -> None:
    """Normalisation is the server's job — the bot must not second-guess it."""
    body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body.update(json.loads(request.content))
        return json_response(
            {
                "ok": True,
                "data": {
                    "token": "jwt-xyz",
                    "customer": {"id": "u1", "name": "مریم", "phone": "09123456789"},
                    "welcome": "خوش آمدید",
                },
            }
        )

    client = api_with(handler)
    customer = await client.identify(
        telegram_id=555, name="مریم", phone="۰۹۱۲۳۴۵۶۷۸۹", telegram_username="maryam"
    )

    assert body["phone"] == "۰۹۱۲۳۴۵۶۷۸۹"  # exactly what the customer typed
    assert body["telegramId"] == "555"
    assert body["telegramUsername"] == "maryam"
    assert customer.token == "jwt-xyz"
    assert customer.phone == "09123456789"  # the server's canonical form
    await client.aclose()


@pytest.mark.asyncio
async def test_phone_conflict_surfaces_as_a_conflict() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": {
                    "code": "CONFLICT",
                    "message": "This phone number is linked to another Telegram account",
                    "reason": "PHONE_TAKEN",
                }
            },
        )

    client = api_with(handler)
    with pytest.raises(ChannelError) as excinfo:
        await client.identify(telegram_id=1, name="a", phone="09120000000")
    assert excinfo.value.code == "CONFLICT"
    assert excinfo.value.details.get("reason") == "PHONE_TAKEN"
    await client.aclose()


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_availability_day_filters_free_slots() -> None:
    payload = {
        "ok": True,
        "data": {
            "kind": "day",
            "date": "2026-10-01",
            "slots": [
                {"start": 1000, "label": "09:00", "available": False, "reason": "busy"},
                {"start": 2000, "label": "10:00", "available": True},
            ],
        },
    }
    client = api_with(lambda request: json_response(payload))
    day = await client.availability_day(service_id="s1", date="2026-10-01", staff_id="st1")

    assert len(day.slots) == 2
    assert [slot.label for slot in day.free] == ["10:00"]
    assert day.has_free is True
    await client.aclose()


@pytest.mark.asyncio
async def test_availability_range_sends_staff_and_days() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return json_response(
            {
                "ok": True,
                "data": {
                    "days": [
                        {"date": "2026-10-01", "bookable": True, "freeCount": 4},
                        {"date": "2026-10-02", "bookable": False, "freeCount": 0},
                    ]
                },
            }
        )

    client = api_with(handler)
    days = await client.availability_days(service_id="s1", staff_id="st1", days=14)

    assert seen["serviceId"] == "s1"
    assert seen["staffId"] == "st1"
    assert seen["days"] == "14"
    assert [day.date for day in days if day.bookable] == ["2026-10-01"]
    await client.aclose()


# ---------------------------------------------------------------------------
# Booking
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_booking_returns_the_appointment_views() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["slot"] == 2000
        return json_response(
            {
                "ok": True,
                "data": {
                    "count": 1,
                    "trackingCode": "APT-AB12C",
                    "message": "✅ نوبت شما ثبت شد",
                    "appointments": [
                        {
                            "trackingCode": "APT-AB12C",
                            "status": "CONFIRMED",
                            "statusLabel": "تأیید شده",
                            "isUpcoming": True,
                            "cancellable": True,
                            "service": {"title": "پاکسازی"},
                            "staff": {"name": "مهسا"},
                            "when": {"date": "پنجشنبه ۱ آذر", "startsAt": "2026-11-22T06:00:00Z"},
                            "webUrl": "http://web.test/fa/my-appointments/APT-AB12C",
                        }
                    ],
                },
            }
        )

    client = api_with(handler)
    booking = await client.book(
        customer_token="jwt", telegram_id=7, service_id="s1", slot=2000, staff_id="st1"
    )

    assert booking.count == 1
    assert booking.tracking_code == "APT-AB12C"
    assert booking.appointments[0].service_title == "پاکسازی"
    assert booking.appointments[0].active is True
    await client.aclose()


@pytest.mark.asyncio
async def test_a_taken_slot_becomes_a_slot_taken_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": {
                    "code": "SLOT_TAKEN",
                    "message": "این بازه هم‌اکنون رزرو شد.",
                    "occurrence": 3,
                }
            },
        )

    client = api_with(handler)
    with pytest.raises(ChannelError) as excinfo:
        await client.book(customer_token="jwt", telegram_id=7, service_id="s1", slot=1)
    assert excinfo.value.slot_taken is True
    assert excinfo.value.details["occurrence"] == 3
    await client.aclose()


@pytest.mark.asyncio
async def test_recurring_booking_sends_the_repeat_count() -> None:
    body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body.update(json.loads(request.content))
        return json_response({"ok": True, "data": {"count": 4, "appointments": []}})

    client = api_with(handler)
    result = await client.book(
        customer_token="jwt", telegram_id=7, service_id="s1", slot=1, repeat_count=4
    )
    assert body["repeatCount"] == 4
    assert result.count == 4
    await client.aclose()


# ---------------------------------------------------------------------------
# Failures the bot must survive
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_a_dead_web_app_becomes_channel_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = api_with(handler)
    with pytest.raises(ChannelUnavailable):
        await client.catalogue()
    await client.aclose()


@pytest.mark.asyncio
async def test_rate_limiting_is_recognised() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"code": "RATE_LIMITED", "message": "slow down"}})

    client = api_with(handler)
    with pytest.raises(ChannelError) as excinfo:
        await client.catalogue()
    assert excinfo.value.rate_limited is True
    await client.aclose()


@pytest.mark.asyncio
async def test_a_non_json_error_page_does_not_crash_the_client() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>Internal Server Error</html>")

    client = api_with(handler)
    with pytest.raises(ChannelError) as excinfo:
        await client.catalogue()
    assert excinfo.value.status == 500
    await client.aclose()


# ---------------------------------------------------------------------------
# Grouping helper
# ---------------------------------------------------------------------------
def test_group_by_date_keeps_order() -> None:
    from channel.api import Appointment

    def make(code: str, when: str) -> Appointment:
        return Appointment(
            tracking_code=code,
            status="CONFIRMED",
            status_label="تأیید شده",
            is_upcoming=True,
            cancellable=True,
            service_title="سرویس",
            staff_name="کارشناس",
            when_text=when,
            when_iso="",
            location_title=None,
            used_package_session=False,
            web_url="",
        )

    grouped = group_by_date(
        [make("A", "۱ آذر"), make("B", "۱ آذر"), make("C", "۲ آذر")]
    )
    assert [day for day, _items in grouped] == ["۱ آذر", "۲ آذر"]
    assert len(grouped[0][1]) == 2
