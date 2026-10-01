"""
Web panel rendering helpers: one Jinja2 environment shared by every route.

    render(...)          -> template response (also shows the "flash" messages)
    flash(...)           -> one-shot success/error message for the next page
    page_url(...)        -> link that keeps the current filters and changes page
"""

from __future__ import annotations

from datetime import date, datetime, time
from pathlib import Path
from urllib.parse import urlencode

from starlette.requests import Request
from starlette.responses import RedirectResponse
from starlette.templating import Jinja2Templates

from utils.calendar import to_jalali
from utils.constants import (
    PAGE_SIZE_WEB,
    STATUS_LABELS_FA,
    TICKET_LABELS_FA,
    WAITLIST_LABELS_FA,
)

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


# ---------------------------------------------------------------------------
# Small template helpers (exposed as Jinja globals)
# ---------------------------------------------------------------------------
def jalali(value: date | datetime | str | None) -> str:
    """Any date-ish value -> '1405/07/10' (Persian UI never shows Gregorian)."""
    if value is None:
        return "—"
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value[:10])
        except ValueError:
            return value
    if isinstance(value, datetime):
        value = value.date()
    return to_jalali(value)


def hhmm(value: time | None) -> str:
    """Always 24-hour '09:00' (SQLite returns datetime.time objects)."""
    if value is None:
        return "—"
    return value.strftime("%H:%M")


def status_fa(value: str) -> str:
    return STATUS_LABELS_FA.get(value, value)


def wait_fa(value: str) -> str:
    return WAITLIST_LABELS_FA.get(value, value)


def ticket_fa(value: str) -> str:
    return TICKET_LABELS_FA.get(value, value)


def money(value: int | None) -> str:
    """150000 -> '150,000' (price is informational only - there is NO payment)."""
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "0"


# Navigation of the panel (same order as the sidebar)
NAV_ITEMS: list[tuple[str, str]] = [
    ("/", "📊 داشبورد"),
    ("/appointments", "📅 نوبت‌ها"),
    ("/users", "👥 کاربران"),
    ("/staff", "🧑‍💼 کارکنان"),
    ("/services", "🛠 خدمات"),
    ("/working-hours", "🕐 ساعات کاری"),
    ("/holidays", "🚫 تعطیلات"),
    ("/waitlist", "⏳ لیست انتظار"),
    ("/tickets", "📨 تیکت‌ها"),
    ("/reports", "📈 گزارش‌ها"),
    ("/settings", "⚙️ تنظیمات"),
]


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
def _context_processor(request: Request) -> dict:
    """
    Data available in every template.

    The flash messages are removed from the session here, so each message is
    displayed exactly once.
    """
    session = request.session
    return {
        "flashes": session.pop("flashes", []),
        "csrf_token": session.get("csrf", ""),
        "current_path": request.url.path,
        "nav_items": NAV_ITEMS,
        "is_admin_page": request.url.path != "/login",
        "web_admin": session.get("web_admin", ""),
    }


templates = Jinja2Templates(
    directory=str(TEMPLATES_DIR), context_processors=[_context_processor]
)
templates.env.globals.update(
    jalali=jalali,
    hhmm=hhmm,
    status_fa=status_fa,
    wait_fa=wait_fa,
    ticket_fa=ticket_fa,
    money=money,
    PAGE_SIZE=PAGE_SIZE_WEB,
)


# ---------------------------------------------------------------------------
# Flash messages
# ---------------------------------------------------------------------------
def flash(request: Request, text: str, level: str = "ok") -> None:
    """Queue a message shown at the top of the next rendered page."""
    request.session.setdefault("flashes", []).append({"text": text, "level": level})


def redirect_back(request: Request, default: str = "/") -> RedirectResponse:
    """Go back to the page that contained the form (filters are preserved)."""
    target = request.headers.get("referer") or default
    return RedirectResponse(target, status_code=303)


def render(request: Request, name: str, status_code: int = 200, **context):
    """Render a template of ``web/templates``."""
    return templates.TemplateResponse(request, name, context, status_code=status_code)


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------
def page_url(request: Request, page: int, **extra) -> str:
    """``/users?search=ali&page=3`` -> link of page N keeping every filter."""
    params = {key: value for key, value in request.query_params.items() if value}
    params.pop("page", None)
    for key, value in extra.items():
        if value in (None, ""):
            params.pop(key, None)
        else:
            params[key] = str(value)
    params["page"] = str(page)
    query = urlencode(params)
    return f"{request.url.path}?{query}"


def page_context(request: Request, page: int, total: int, per_page: int = PAGE_SIZE_WEB) -> dict:
    """Everything ``_pagination.html`` needs."""
    total_pages = max(1, -(-total // per_page))
    page = max(1, min(page, total_pages))
    window = list(range(max(1, page - 2), min(total_pages, page + 2) + 1))
    return {
        "page": page,
        "total_pages": total_pages,
        "total": total,
        "window": window,
        "has_prev": page > 1,
        "has_next": page < total_pages,
        "prev_url": page_url(request, page - 1),
        "next_url": page_url(request, page + 1),
        "page_url": page_url,  # callable(page)
    }
