"""Handler package - assembles every router of the bot in the right order.

Registration order is important:

1. ``common``  - /start, menu, cancel & back buttons (must win over FSM states)
2. user flows  - registration, booking, my-appointments, profile, support
3. admin flows - the whole Telegram admin panel (``/admin``)
"""

from __future__ import annotations

from aiogram import Router

from handlers import (
    appointment,
    common,
    my_appointments,
    profile,
    registration,
    start,
    support,
)
from handlers.admin import admin_routers


def get_routers() -> list[Router]:
    """Return every router of the bot in registration order."""
    routers: list[Router] = [
        common.router,
        start.router,
        registration.router,
        appointment.router,
        my_appointments.router,
        profile.router,
        support.router,
    ]
    routers.extend(admin_routers)
    return routers


__all__ = ["get_routers"]
