"""Admin sub-package: one router per section of the Telegram admin panel.

Import order matters - the generic "common" handlers (cancel / back) live in
``handlers.common`` and are registered first by ``handlers.get_routers()``.
"""

from __future__ import annotations

from aiogram import Router

from handlers.admin import (
    appointments,
    base,
    dashboard,
    holidays,
    hours,
    reports,
    services,
    settings,
    staff,
    tickets,
    users,
    waitlist,
)

admin_routers: list[Router] = [
    base.router,
    dashboard.router,
    appointments.router,
    users.router,
    services.router,
    staff.router,
    hours.router,
    holidays.router,
    waitlist.router,
    tickets.router,
    reports.router,
    settings.router,
]

__all__ = ["admin_routers"]
