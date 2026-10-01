"""Waitlist: who is waiting for a free slot, and manual re-notification."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from database.session import session_scope
from services import notification_service, waitlist_service
from utils.constants import WAITLIST_STATUSES
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["waitlist"], dependencies=[Depends(require_admin)])


@router.get("/waitlist")
async def waitlist_page(request: Request, status: str = "", page: int = 1):
    with session_scope() as session:
        rows = waitlist_service.list_entries(
            session, status=status or None
        )
    result = paginate(rows, page, 15)
    return render(
        request,
        "waitlist.html",
        rows=result.items,
        status=status,
        statuses=WAITLIST_STATUSES,
        pager=page_context(request, result.page, len(rows)),
    )


@router.post("/waitlist/{entry_id}/notify", dependencies=[Depends(csrf)])
async def notify_entry(request: Request, entry_id: int):
    """Offer the currently free slots of that (staff, day) to waiting users."""
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            flash(request, "رکورد یافت نشد.", "err")
            return redirect_back(request, "/waitlist")
        staff_id, day = entry.staff_id, entry.date
    sent = await notification_service.notify_waitlist_entries(staff_id, day)
    flash(request, f"{sent} پیام «آزاد شدن نوبت» ارسال شد.")
    return redirect_back(request, "/waitlist")


@router.post("/waitlist/{entry_id}/status", dependencies=[Depends(csrf)])
async def change_status(request: Request, entry_id: int, status: str = "cancelled"):
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is None:
            flash(request, "رکورد یافت نشد.", "err")
            return redirect_back(request, "/waitlist")
        try:
            waitlist_service.set_status(session, entry, status)
            flash(request, "وضعیت لیست انتظار به‌روزرسانی شد.")
        except waitlist_service.WaitlistError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/waitlist")


@router.post("/waitlist/{entry_id}/delete", dependencies=[Depends(csrf)])
async def delete_entry(request: Request, entry_id: int):
    with session_scope() as session:
        entry = waitlist_service.get(session, entry_id)
        if entry is not None:
            waitlist_service.remove(session, entry)
            flash(request, "رکورد حذف شد.")
        else:
            flash(request, "رکورد یافت نشد.", "err")
    return redirect_back(request, "/waitlist")
