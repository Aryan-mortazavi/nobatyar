"""Appointment list with filters + status changes (confirm/cancel/complete...)."""

from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import or_, select

from database.models import Appointment, Service, Staff, User
from database.queries import filter_appointments
from database.session import session_scope
from services import appointment_service, notification_service
from services.appointment_service import BookingError
from utils.constants import APPOINTMENT_STATUSES, STATUS_CANCELLED
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["appointments"], dependencies=[Depends(require_admin)])


def _parse_day(value: str) -> date_type | None:
    try:
        return date_type.fromisoformat(value) if value else None
    except ValueError:
        return None


@router.get("/appointments")
async def appointments_page(
    request: Request,
    status: str = "",
    staff_id: int = 0,
    service_id: int = 0,
    q: str = "",
    day: str = "",
    page: int = 1,
):
    day_value = _parse_day(day)
    with session_scope() as session:
        rows = filter_appointments(
            session,
            day=day_value,
            staff_id=staff_id or None,
            service_id=service_id or None,
            status=status or None,
        )
        if q.strip():
            needle = q.strip()
            rows = [
                appt
                for appt in rows
                if needle in (appt.tracking_code or "")
                or (
                    appt.user is not None
                    and needle in f"{appt.user.first_name} {appt.user.last_name}"
                )
            ]
        staff_list = list(session.scalars(select(Staff).order_by(Staff.id)))
        service_list = list(session.scalars(select(Service).order_by(Service.id)))

    result = paginate(rows, page, 15)
    return render(
        request,
        "appointments.html",
        rows=result.items,
        status=status,
        staff_id=staff_id,
        service_id=service_id,
        q=q,
        day=day,
        staff_list=staff_list,
        service_list=service_list,
        statuses=APPOINTMENT_STATUSES,
        pager=page_context(request, result.page, len(rows)),
    )


@router.post("/appointments/{appointment_id}/status", dependencies=[Depends(csrf)])
async def change_status(
    request: Request, appointment_id: int, status: str = Form(...)
):
    """Change the status and inform the user (and the waitlist on cancel)."""
    if status not in APPOINTMENT_STATUSES:
        flash(request, "وضعیت نامعتبر است.", "err")
        return redirect_back(request, "/appointments")

    user_tg: int | None = None
    text = ""
    staff_id = 0
    day = None
    freed = False

    try:
        with session_scope() as session:
            appt = appointment_service.get(session, appointment_id)
            if appt is None:
                flash(request, "نوبت یافت نشد.", "err")
                return redirect_back(request, "/appointments")
            appointment_service.set_status(session, appt, status)
            text = notification_service.appointment_status_text(session, appt, status)
            user = session.get(User, appt.user_id)
            user_tg = user.telegram_id if user else None
            staff_id = appt.staff_id
            day = appt.date
            freed = status == STATUS_CANCELLED
            code = appt.tracking_code
    except BookingError as exc:
        flash(request, str(exc), "err")
        return redirect_back(request, "/appointments")

    if user_tg:
        await notification_service.send(
            user_tg, text, ntype=f"appointment_{status}"
        )
    if freed:
        await notification_service.notify_waitlist_entries(staff_id, day)

    flash(request, f"وضعیت نوبت {code} تغییر کرد.")
    return redirect_back(request, "/appointments")


@router.post("/appointments/{appointment_id}/notify", dependencies=[Depends(csrf)])
async def notify_user(request: Request, appointment_id: int):
    """Send the appointment card to the user again (manual reminder)."""
    with session_scope() as session:
        appt = appointment_service.get(session, appointment_id)
        if appt is None:
            flash(request, "نوبت یافت نشد.", "err")
            return redirect_back(request, "/appointments")
        user = session.get(User, appt.user_id)
        user_tg = user.telegram_id if user else None
        text = notification_service.appointment_status_text(session, appt, appt.status)
        code = appt.tracking_code
    if user_tg:
        await notification_service.send(user_tg, text, ntype="admin_message")
        flash(request, f"اطلاعات نوبت {code} برای کاربر ارسال شد.")
    else:
        flash(request, "کاربر تلگرامی برای این نوبت یافت نشد.", "err")
    return redirect_back(request, "/appointments")
