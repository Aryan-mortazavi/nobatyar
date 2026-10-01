"""Weekly working hours + break times (Persian week: شنبه = 0)."""

from __future__ import annotations

from datetime import time

from fastapi import APIRouter, Depends, Form, Request

from database.session import session_scope
from services import staff_service
from services.staff_service import StaffError
from utils.constants import PERSIAN_DAYS
from web.auth import csrf, require_admin
from web.render import flash, redirect_back, render

router = APIRouter(tags=["working-hours"], dependencies=[Depends(require_admin)])


def _time(value: str, default: time) -> time:
    """'09:30' -> time(9, 30) (invalid input keeps the previous value)."""
    try:
        hour, minute = value.split(":")
        return time(int(hour) % 24, int(minute) % 60)
    except (ValueError, AttributeError):
        return default


@router.get("/working-hours")
async def working_hours_page(request: Request, staff_id: int = 0):
    with session_scope() as session:
        staff_list = staff_service.list_staff(session)
        if not staff_list:
            return render(
                request, "working_hours.html", staff_list=[], rows=[], breaks=[],
                days=list(enumerate(PERSIAN_DAYS)), current=None,
            )
        if not any(member.id == staff_id for member in staff_list):
            staff_id = staff_list[0].id
        current = staff_service.get(session, staff_id)
        rows = {h.day_of_week: h for h in staff_service.working_hours(session, staff_id)}
        breaks = staff_service.breaks(session, staff_id)
    return render(
        request,
        "working_hours.html",
        staff_list=staff_list,
        current=current,
        rows=rows,
        breaks=breaks,
        days=list(enumerate(PERSIAN_DAYS)),
    )


@router.post("/working-hours/{staff_id}/day/{day_of_week}", dependencies=[Depends(csrf)])
async def save_day(
    request: Request,
    staff_id: int,
    day_of_week: int,
    start: str = Form("08:00"),
    end: str = Form("18:00"),
    active: str = Form(""),
):
    """Create / update the working interval of one weekday (upsert)."""
    if day_of_week not in range(7):
        flash(request, "روز هفته نامعتبر است.", "err")
        return redirect_back(request, "/working-hours")
    try:
        with session_scope() as session:
            member = staff_service.get(session, staff_id)
            if member is None:
                flash(request, "کارشناس یافت نشد.", "err")
                return redirect_back(request, "/working-hours")
            staff_service.set_working_hours(
                session,
                staff_id,
                day_of_week,
                _time(start, time(8, 0)),
                _time(end, time(18, 0)),
                is_active=active == "yes",
            )
        flash(request, f"ساعات کاری {PERSIAN_DAYS[day_of_week]} ذخیره شد.")
    except StaffError as exc:
        flash(request, str(exc), "err")
    return redirect_back(request, "/working-hours")


@router.post("/working-hours/{staff_id}/toggle/{hour_id}", dependencies=[Depends(csrf)])
async def toggle_day(request: Request, staff_id: int, hour_id: int):
    with session_scope() as session:
        try:
            active = staff_service.toggle_working_hour(session, hour_id)
            state = "فعال" if active else "غیرفعال"
            flash(request, f"این روز {state} شد.")
        except StaffError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/working-hours")


@router.post("/working-hours/{staff_id}/breaks", dependencies=[Depends(csrf)])
async def add_break(
    request: Request,
    staff_id: int,
    day_of_week: int = Form(0),
    start: str = Form("12:00"),
    end: str = Form("13:00"),
):
    try:
        with session_scope() as session:
            staff_service.add_break(
                session,
                staff_id,
                int(day_of_week),
                _time(start, time(12, 0)),
                _time(end, time(13, 0)),
            )
        flash(request, "زمان استراحت اضافه شد.")
    except (StaffError, ValueError) as exc:
        flash(request, str(exc), "err")
    return redirect_back(request, "/working-hours")


@router.post("/working-hours/{staff_id}/breaks/{break_id}/toggle", dependencies=[Depends(csrf)])
async def toggle_break(request: Request, staff_id: int, break_id: int):
    with session_scope() as session:
        try:
            active = staff_service.toggle_break(session, break_id)
            state = "فعال" if active else "غیرفعال"
            flash(request, f"استراحت {state} شد.")
        except StaffError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/working-hours")


@router.post("/working-hours/{staff_id}/breaks/{break_id}/delete", dependencies=[Depends(csrf)])
async def delete_break(request: Request, staff_id: int, break_id: int):
    with session_scope() as session:
        staff_service.delete_break(session, break_id)
    flash(request, "زمان استراحت حذف شد.")
    return redirect_back(request, "/working-hours")
