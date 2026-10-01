"""GET / - dashboard with counters and the Chart.js graphs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from database import queries
from database.session import session_scope
from utils.calendar import persian_weekday, tehran_now
from web.auth import require_admin
from web.render import jalali, render

router = APIRouter(tags=["dashboard"], dependencies=[Depends(require_admin)])


@router.get("/")
async def dashboard(request: Request):
    now = tehran_now()
    with session_scope() as session:
        stats = queries.dashboard_stats(session)
        status_counts = queries.appointments_by_status(session)
        trend = queries.appointments_last_days(session, days=7)
        staff_load = queries.staff_load(session)
        service_load = queries.service_load(session)
        today_list = queries.filter_appointments(session, day=now.date())

    # Chart data (labels are Persian / Jalali - never Gregorian)
    status_labels = [
        status_fa(key)
        for key in ("pending", "confirmed", "completed", "cancelled", "no_show")
    ]
    status_values = [
        status_counts.get(key, 0)
        for key in ("pending", "confirmed", "completed", "cancelled", "no_show")
    ]
    trend_labels = [_trend_label(iso) for iso, _ in trend]
    trend_values = [count for _, count in trend]

    return render(
        request,
        "dashboard.html",
        stats=stats,
        now=now,
        today_list=today_list[:10],
        weekday=persian_weekday(now.date()),
        status_labels=status_labels,
        status_values=status_values,
        trend_labels=trend_labels,
        trend_values=trend_values,
        staff_load=[(name, count) for name, count in staff_load[:6]],
        service_load=[(name, count) for name, count in service_load[:6]],
    )


def _trend_label(iso_date: str) -> str:
    """'2026-09-28' -> '28 مهر' (short Jalali label for the axis)."""
    from datetime import date as date_type

    try:
        day = date_type.fromisoformat(iso_date)
    except ValueError:  # pragma: no cover - defensive
        return iso_date
    text = jalali(day)  # 1405/07/10
    return text.split("/", 2)[2] + "/" + text.split("/", 2)[1]


def status_fa(key: str) -> str:
    from utils.constants import STATUS_LABELS_FA

    return STATUS_LABELS_FA.get(key, key)
