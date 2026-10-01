"""Holidays: days on which no appointment can be booked at all."""

from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import select

from database.models import Holiday
from database.session import session_scope
from utils.helpers import paginate
from utils.validators import parse_jalali_input
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["holidays"], dependencies=[Depends(require_admin)])


@router.get("/holidays")
async def holidays_page(request: Request, page: int = 1):
    with session_scope() as session:
        rows = list(session.scalars(select(Holiday).order_by(Holiday.date)))
    result = paginate(rows, page, 15)
    return render(
        request,
        "holidays.html",
        rows=result.items,
        pager=page_context(request, result.page, len(rows)),
    )


@router.post("/holidays", dependencies=[Depends(csrf)])
async def add_holiday(
    request: Request,
    jalali_date: str = Form(...),
    note: str = Form(""),
):
    """The date is typed in Jalali (1405/07/10) - stored as a Gregorian date."""
    day = parse_jalali_input(jalali_date)
    if day is None:
        flash(request, "تاریخ شمسی نامعتبر است. نمونه: 1405/07/10", "err")
        return redirect_back(request, "/holidays")

    with session_scope() as session:
        exists = session.scalar(select(Holiday).where(Holiday.date == day))
        if exists is not None:
            flash(request, "این تاریخ قبلاً به عنوان تعطیل ثبت شده است.", "err")
            return redirect_back(request, "/holidays")
        session.add(Holiday(date=day, note=note.strip()))
    flash(request, "روز تعطیل جدید اضافه شد.")
    return redirect_back(request, "/holidays")


@router.post("/holidays/{holiday_id}/delete", dependencies=[Depends(csrf)])
async def delete_holiday(request: Request, holiday_id: int):
    with session_scope() as session:
        row = session.get(Holiday, holiday_id)
        if row is None:
            flash(request, "رکورد یافت نشد.", "err")
            return redirect_back(request, "/holidays")
        session.delete(row)
    flash(request, "روز تعطیل حذف شد.")
    return redirect_back(request, "/holidays")
