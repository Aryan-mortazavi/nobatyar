"""Reports: daily (one Jalali day) and monthly (one Jalali month)."""

from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, Request

from database.queries import appointments_by_status, appointments_last_days, staff_load
from database.session import session_scope
from services import report_service
from utils.calendar import tehran_now, to_jalali
from utils.helpers import jalali_ym
from utils.validators import parse_jalali_input
from web.auth import require_admin
from web.render import flash, render

router = APIRouter(tags=["reports"], dependencies=[Depends(require_admin)])


@router.get("/reports")
async def reports_page(
    request: Request,
    year: int = 0,
    month: int = 0,
    day: str = "",
):
    today = tehran_now().date()
    current_year, current_month = jalali_ym(today)

    year = year or current_year
    month = month or current_month
    if not 1 <= month <= 12:
        year, month = current_year, current_month

    selected_day = parse_jalali_input(day) if day else today
    if selected_day is None:
        flash(request, "تاریخ شمسی نامعتبر است؛ گزارش امروز نمایش داده شد.", "warn")
        selected_day = today

    with session_scope() as session:
        daily = report_service.daily_report(session, selected_day)
        monthly = report_service.monthly_report(session, year, month)
        status_counts = appointments_by_status(session)
        trend = appointments_last_days(session, days=14)
        load = staff_load(session)

    return render(
        request,
        "reports.html",
        daily=daily,
        monthly=monthly,
        year=year,
        month=month,
        day_value=selected_day,
        day_input=to_jalali(selected_day),
        status_counts=status_counts,
        trend_labels=[_short_label(iso) for iso, _ in trend],
        trend_values=[count for _, count in trend],
        load=[(name, count) for name, count in load],
        prev_month=_shift_month(year, month, -1),
        next_month=_shift_month(year, month, 1),
    )


def _short_label(iso_date: str) -> str:
    try:
        day = date_type.fromisoformat(iso_date)
    except ValueError:  # pragma: no cover
        return iso_date
    text = to_jalali(day)
    return "/".join(text.split("/")[1:])


def _shift_month(year: int, month: int, step: int) -> tuple[int, int]:
    value = month + step
    if value < 1:
        return year - 1, 12
    if value > 12:
        return year + 1, 1
    return year, value
