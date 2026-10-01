"""Support tickets: user message -> admin reply (through Telegram)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import SupportTicket


class TicketError(ValueError):
    """Raised for invalid ticket operations (Persian message)."""


def create(session: Session, *, user_id: int, message: str) -> SupportTicket:
    """A user sends one message to support -> one ticket."""
    message = message.strip()
    if not message:
        raise TicketError("❌ متن پیام نمی‌تواند خالی باشد.")
    if len(message) > 2000:
        raise TicketError("❌ متن پیام طولانی است (حداکثر ۲۰۰۰ کاراکتر).")
    ticket = SupportTicket(user_id=user_id, message=message, status="open")
    session.add(ticket)
    session.flush()
    return ticket


def get(session: Session, ticket_id: int) -> SupportTicket | None:
    return session.get(SupportTicket, ticket_id)


def list_tickets(
    session: Session, *, status: str | None = None, user_id: int | None = None
) -> list[SupportTicket]:
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    if user_id:
        stmt = stmt.where(SupportTicket.user_id == user_id)
    stmt = stmt.order_by(SupportTicket.created_at.desc())
    return list(session.scalars(stmt))


def reply(session: Session, ticket: SupportTicket, text: str) -> SupportTicket:
    """Admin answers a ticket (the reply is sent back through Telegram)."""
    text = text.strip()
    if not text:
        raise TicketError("❌ متن پاسخ نمی‌تواند خالی باشد.")
    ticket.admin_reply = text
    ticket.status = "answered"
    session.flush()
    return ticket


def set_status(session: Session, ticket: SupportTicket, status: str) -> None:
    if status not in SupportTicket.STATUSES:
        raise TicketError("❌ وضعیت نامعتبر است.")
    ticket.status = status
    session.flush()


def open_count(session: Session) -> int:
    return len(
        list(
            session.scalars(
                select(SupportTicket).where(SupportTicket.status == "open")
            )
        )
    )
