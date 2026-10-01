"""
Live integration test: the bot's own client against a real NobatYar server.

Skipped unless the environment points at a running web app::

    CHANNEL_API_URL=http://localhost:3000
    CHANNEL_API_SECRET=<the value from the web app's .env>
    pytest tests/test_live_channel.py

This is the test that proves the two projects actually fit together — the unit
suite can only prove the client speaks HTTP correctly.
"""

from __future__ import annotations

import os
import random
from pathlib import Path

import pytest

from channel.api import ChannelApi, ChannelError, ChannelUnavailable


def _from_dotenv() -> tuple[str, str]:
    """
    Read the bridge settings the same way the bot does.

    The test must work with no extra ceremony: whoever has a working ``.env``
    (which the bot needs anyway) can run the integration suite immediately.
    """
    try:
        import config  # noqa: PLC0415 - deliberately late, it reads .env

        return config.WEB_API_URL, config.CHANNEL_API_SECRET
    except Exception:  # noqa: BLE001 - a missing/!invalid .env just means skip
        url = os.getenv("CHANNEL_API_URL", "").strip()
        secret = os.getenv("CHANNEL_API_SECRET", "").strip()
        for candidate in (
            Path(__file__).resolve().parents[1] / ".env",
            Path(__file__).resolve().parents[2] / "nobatyar" / ".env",
        ):
            if not secret and candidate.exists():
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    if line.startswith("CHANNEL_API_SECRET="):
                        secret = line.split("=", 1)[1].strip().strip("\"'")
        return url, secret


BASE_URL, _SECRET = _from_dotenv()
SECRET = os.getenv("CHANNEL_API_SECRET", "").strip() or _SECRET

pytestmark = pytest.mark.skipif(
    not (BASE_URL and SECRET),
    reason="configure WEB_API_URL + CHANNEL_API_SECRET in .env to run the live channel test",
)


def _secret() -> str:
    """Fall back to the sibling web app's .env, the usual local setup."""
    if SECRET:
        return SECRET
    for candidate in (
        Path(__file__).resolve().parents[2] / "nobatyar" / ".env",
        Path("..") / "nobatyar" / ".env",
    ):
        if candidate.exists():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                if line.startswith("CHANNEL_API_SECRET="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return ""


@pytest.fixture
async def client():
    from channel.api import ChannelApi

    secret = SECRET
    if not secret:
        pytest.skip("CHANNEL_API_SECRET not found")
    api = ChannelApi(BASE_URL, secret)
    if not await api.health():
        await api.aclose()
        pytest.skip(f"the web app at {BASE_URL} is not answering")
    yield api
    await api.aclose()


def fresh_phone() -> str:
    return f"09{random.randint(0, 999_999_999):09d}"


async def test_full_customer_journey(client: ChannelApi) -> None:
    """Identify → look → book → see → cancel, exactly as a customer would."""
    telegram_id = random.randint(10_000_000, 9_999_999_999)
    phone = fresh_phone()

    # 1. the catalogue fills the menu
    catalogue = await client.catalogue()
    assert catalogue.services, "the business has no bookable service"
    assert catalogue.workspace.title
    service = catalogue.services[0]
    assert catalogue.staff_for(service.id), f"nobody offers {service.title}"

    # 2. the Telegram account becomes a real customer
    customer = await client.identify(
        telegram_id=telegram_id, name="مشتری تست یکپارچه", phone=phone
    )
    assert customer.token
    assert customer.phone == phone, "the server normalises the phone number"

    # 3. free time exists somewhere in the horizon
    days = await client.availability_days(service_id=service.id, days=30)
    bookable = [day for day in days if day.bookable]
    assert bookable, "no bookable day in the next 30 days"

    target = bookable[-1]  # far from the demo data, so this test is repeatable
    day = await client.availability_day(
        service_id=service.id, staff_id="any", date=target.date
    )
    assert day.has_free, f"{target.date} is marked bookable but has no free slot"
    slot = day.free[0]

    # 4. book
    booking = await client.book(
        customer_token=customer.token,
        telegram_id=telegram_id,
        service_id=service.id,
        staff_id="any",
        slot=slot.start,
        notes="رزرو تست یکپارچگی",
    )
    assert booking.count == 1
    assert booking.tracking_code and booking.tracking_code.startswith("APT-")
    assert booking.appointments[0].active

    try:
        # 5. it shows up in "my appointments"…
        mine = await client.my_appointments(
            customer_token=customer.token, telegram_id=telegram_id
        )
        assert any(item.tracking_code == booking.tracking_code for item in mine)

        # …and in *all* scopes, which is what the detail screen uses
        every = await client.my_appointments(
            customer_token=customer.token, telegram_id=telegram_id, scope="all"
        )
        assert any(item.tracking_code == booking.tracking_code for item in every)

        # 6. booking the very same slot again is refused by the engine
        with pytest.raises(ChannelError) as excinfo:
            await client.book(
                customer_token=customer.token,
                telegram_id=telegram_id,
                service_id=service.id,
                staff_id="any",
                slot=slot.start,
            )
        assert excinfo.value.slot_taken

        # 7. a stranger's token cannot cancel it
        stranger = await client.identify(
            telegram_id=telegram_id + 1, name="مشتری غریبه", phone=fresh_phone()
        )
        assert stranger.token, "the second customer could not identify"
        assert stranger.id != customer.id, "two chats resolved to the same customer"
        with pytest.raises(ChannelError) as excinfo:
            await client.cancel(
                customer_token=stranger.token,
                telegram_id=telegram_id + 1,
                tracking_code=booking.tracking_code,
            )
        assert excinfo.value.status in (403, 404)

        # 8. packages: this brand-new customer has none, but the call works
        assert await client.packages(
            customer_token=customer.token, telegram_id=telegram_id
        ) == []

    finally:
        # always give the slot back, whatever happened above
        await client.cancel(
            customer_token=customer.token,
            telegram_id=telegram_id,
            tracking_code=booking.tracking_code or "",
        )


async def test_waitlist_and_support_reach_the_web_app(client: ChannelApi) -> None:
    """The other two customer-facing channels land in the same queues as the web."""
    telegram_id = random.randint(10_000_000, 9_999_999_999)
    customer = await client.identify(
        telegram_id=telegram_id, name="مشتری پشتیبانی", phone=fresh_phone()
    )
    catalogue = await client.catalogue()
    service = catalogue.services[0]

    days = await client.availability_days(service_id=service.id, days=30)
    target = [day for day in days if day.bookable][-1]

    joined = await client.join_waitlist(
        customer_token=customer.token,
        telegram_id=telegram_id,
        service_id=service.id,
        date=target.date,
        preferred_start_minute=600,
    )
    assert joined.get("created") is True

    # the same day is not queued twice
    again = await client.join_waitlist(
        customer_token=customer.token,
        telegram_id=telegram_id,
        service_id=service.id,
        date=target.date,
    )
    assert again.get("created") is False

    ticket = await client.send_support(
        customer_token=customer.token,
        telegram_id=telegram_id,
        message="سلام، این پیام از تست یکپارچگی است.",
    )
    assert ticket.get("ticketId")


async def test_the_channel_secret_is_required(client) -> None:
    """A wrong secret is refused — the integration is not an open door."""
    from channel.api import ChannelApi as Api
    from channel.api import ChannelError, ChannelUnavailable

    rogue = Api(BASE_URL, "x" * 43)
    with pytest.raises((ChannelError, ChannelUnavailable)) as excinfo:
        await rogue.catalogue()
    assert getattr(excinfo.value, "code", "") in {"UNAUTHORIZED", "UNAVAILABLE", "HTTP_401"}
    await rogue.aclose()
