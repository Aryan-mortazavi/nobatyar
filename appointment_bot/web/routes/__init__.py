"""Web routes: one module per page of the admin panel."""

from __future__ import annotations

from fastapi import FastAPI

from web.routes import (
    appointments,
    auth,
    dashboard,
    holidays,
    reports,
    services,
    settings,
    staff,
    tickets,
    users,
    waitlist,
    working_hours,
)

# /login is public; every other router carries its own require_admin dependency
PUBLIC_ROUTERS = (auth.router,)
PRIVATE_ROUTERS = (
    dashboard.router,
    appointments.router,
    users.router,
    services.router,
    staff.router,
    working_hours.router,
    holidays.router,
    waitlist.router,
    tickets.router,
    reports.router,
    settings.router,
)


def include_routes(app: FastAPI) -> None:
    """Attach every route of the panel to the FastAPI application."""
    for router in PUBLIC_ROUTERS:
        app.include_router(router)
    for router in PRIVATE_ROUTERS:
        app.include_router(router)


__all__ = ["include_routes"]
