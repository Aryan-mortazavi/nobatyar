"""Handler package — every router of the customer-facing bot, in order.

1. ``common``  — «❌ انصراف» and «🏠 منوی اصلی» must win over any FSM state
2. ``start``   — /start, /help, about
3. ``registration`` — name + mobile number → a real customer of the web app
4. ``booking`` — the wizard
5. ``my_appointments`` / ``profile`` — list, cancel, packages, support

There is no admin router any more: management and staff live in the web app
(``/dashboard``), which is the single source of truth. A business that wants an
operational alert gets it on Telegram through the web app itself.
"""

from __future__ import annotations

from aiogram import Router

from handlers import booking, common, my_appointments, profile, registration, start

# kept for the reply-keyboard shortcuts
support = profile


def get_routers() -> list[Router]:
    """Return every router of the bot in registration order."""
    return [
        common.router,
        start.router,
        registration.router,
        booking.router,
        my_appointments.router,
        profile.router,
    ]


__all__ = ["get_routers"]
