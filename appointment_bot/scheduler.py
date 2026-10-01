"""
⏰ Background jobs (APScheduler)

    * reminders : 24 hours and 1 hour before every active appointment
                  (each one is sent at most once, cancelled ones are skipped)
    * waitlist  : expired entries are closed automatically

The jobs are interval based, so they also work when the bot was restarted
between two runs - the flags stored in the database prevent duplicates.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database.models import Appointment
from database.session import session_scope
from services import notification_service, waitlist_service
from utils.calendar import tehran_now
from utils.constants import STATUS_CANCELLED, STATUS_CONFIRMED, STATUS_PENDING
from utils.helpers import appointment_datetime

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = (STATUS_PENDING, STATUS_CONFIRMED)
REMINDER_MINUTES = 5  # how often the reminder job wakes up
WAITLIST_MINUTES = 60  # how often expired waitlist rows are cleaned

scheduler = AsyncIOScheduler(timezone="UTC")


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------
async def send_due_reminders() -> int:
    """
    Send the 24h / 1h reminders that are due right now.

    Rules:
      * only pending / confirmed appointments are reminded
      * the 1h reminder is preferred when the appointment is closer than 1h
      * a flag in the database guarantees "no duplicates"
    """
    now = tehran_now()
    sent = 0
    payload: list[tuple[int, str]] = []  # (telegram_id, text) to send after commit

    with session_scope() as session:
        due: list[tuple[Appointment, int]] = []
        rows = session.query(Appointment).filter(
            Appointment.status.in_(ACTIVE_STATUSES)
        )
        for appointment in rows:
            start = appointment_datetime(appointment.date, appointment.start_time)
            delta = start - now
            if delta <= timedelta(0):  # already started / finished
                continue
            if delta <= timedelta(hours=1):
                if not appointment.reminder_1h_sent:
                    due.append((appointment, 1))
            elif delta <= timedelta(hours=24):
                if not appointment.reminder_24h_sent:
                    due.append((appointment, 24))

        for appointment, hours in due:
            text = notification_service.reminder_text(session, appointment, hours)
            telegram_id = appointment.user.telegram_id if appointment.user else None
            if hours == 24:
                appointment.reminder_24h_sent = True
            else:
                appointment.reminder_1h_sent = True
            if telegram_id:
                payload.append((telegram_id, text))

        session.commit()

    # send outside of the session (network call)
    for telegram_id, text in payload:
        if await notification_service.send(
            telegram_id, text, ntype="appointment_reminder"
        ):
            sent += 1

    if sent:
        logger.info("Sent %s appointment reminder(s)", sent)
    return sent


# ---------------------------------------------------------------------------
# Waitlist maintenance
# ---------------------------------------------------------------------------
def close_expired_waitlist() -> int:
    """Waitlist rows for days that already passed become 'expired'."""
    with session_scope() as session:
        closed = waitlist_service.expire_old_entries(session)
    if closed:
        logger.info("Expired %s waitlist entr(ies)", closed)
    return closed


# ---------------------------------------------------------------------------
# Start / stop
# ---------------------------------------------------------------------------
def start() -> AsyncIOScheduler:
    """Start the background jobs (idempotent)."""
    if scheduler.running:
        return scheduler
    scheduler.add_job(
        send_due_reminders,
        "interval",
        minutes=REMINDER_MINUTES,
        id="reminders",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        close_expired_waitlist,
        "interval",
        minutes=WAITLIST_MINUTES,
        id="waitlist_expiry",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("APScheduler started (reminders every %s min)", REMINDER_MINUTES)
    return scheduler


def stop() -> None:
    """Stop the background jobs if they are running."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")


__all__ = ["scheduler", "start", "stop", "send_due_reminders", "close_expired_waitlist"]
