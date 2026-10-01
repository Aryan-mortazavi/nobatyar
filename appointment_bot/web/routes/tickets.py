"""Support tickets: list, read, reply (delivered through Telegram), close."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request

from database.models import User
from database.session import session_scope
from services import notification_service, ticket_service
from services.ticket_service import TicketError
from utils.constants import TICKET_STATUSES
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["tickets"], dependencies=[Depends(require_admin)])


@router.get("/tickets")
async def tickets_page(request: Request, status: str = "", page: int = 1):
    with session_scope() as session:
        rows = ticket_service.list_tickets(session, status=status or None)
        names = {
            row.id: _user_name(session, row.user_id)
            for row in rows
        }
    result = paginate(rows, page, 15)
    return render(
        request,
        "tickets.html",
        rows=result.items,
        names=names,
        status=status,
        statuses=TICKET_STATUSES,
        pager=page_context(request, result.page, len(rows)),
    )


def _user_name(session, user_id: int) -> str:
    from database.models import User

    user = session.get(User, user_id)
    return user.full_name if user else "—"


@router.get("/tickets/{ticket_id}")
async def ticket_detail(request: Request, ticket_id: int):
    with session_scope() as session:
        ticket = ticket_service.get(session, ticket_id)
        if ticket is None:
            flash(request, "تیکت یافت نشد.", "err")
            return redirect_back(request, "/tickets")
        user = session.get(User, ticket.user_id)
    return render(request, "ticket_detail.html", ticket=ticket, user=user)


@router.post("/tickets/{ticket_id}/reply", dependencies=[Depends(csrf)])
async def reply_ticket(request: Request, ticket_id: int, message: str = Form(...)):
    telegram_id: int | None = None
    try:
        with session_scope() as session:
            ticket = ticket_service.get(session, ticket_id)
            if ticket is None:
                flash(request, "تیکت یافت نشد.", "err")
                return redirect_back(request, "/tickets")
            ticket_service.reply(session, ticket, message)
            user = session.get(User, ticket.user_id)
            telegram_id = user.telegram_id if user else None
    except TicketError as exc:
        flash(request, str(exc), "err")
        return redirect_back(request, "/tickets")

    if telegram_id:
        await notification_service.send(
            telegram_id,
            notification_service.support_reply_text(message),
            ntype="support_reply",
        )
        flash(request, "پاسخ برای کاربر ارسال شد.")
    else:
        flash(request, "پاسخ ذخیره شد (کاربر تلگرامی یافت نشد).", "warn")
    return redirect_back(request, f"/tickets/{ticket_id}")


@router.post("/tickets/{ticket_id}/status", dependencies=[Depends(csrf)])
async def ticket_status(request: Request, ticket_id: int, status: str = Form("open")):
    with session_scope() as session:
        ticket = ticket_service.get(session, ticket_id)
        if ticket is None:
            flash(request, "تیکت یافت نشد.", "err")
            return redirect_back(request, "/tickets")
        try:
            ticket_service.set_status(session, ticket, status)
            flash(request, "وضعیت تیکت به‌روزرسانی شد.")
        except TicketError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, f"/tickets/{ticket_id}")
