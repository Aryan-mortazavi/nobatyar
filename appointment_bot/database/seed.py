"""
🌱 Optional demo data.

    python -m database.seed           # add sample users / services / staff / appointments
    python -m database.seed --clear   # remove everything the seed created

The seed is NEVER executed automatically - the application only creates the
tables and the default settings. Every demo row is flagged with ``is_demo=True``
so ``--clear`` removes exactly what it added and nothing else.
"""

from __future__ import annotations

import argparse
import logging
import random
from datetime import timedelta, time

from sqlalchemy import or_, select

from config import setup_logging
from database.init_db import init_db
from database.models import (
    Appointment,
    Notification,
    Service,
    Staff,
    SupportTicket,
    User,
    Waitlist,
)
from database.session import session_scope
from services import appointment_service, service_service, staff_service, user_service
from utils.calendar import tehran_today

logger = logging.getLogger(__name__)

DEMO_USERS = [
    ("علی", "رضایی", "09121111111", 900000001),
    ("سارا", "محمدی", "09122222222", 900000002),
    ("رضا", "کریمی", "09123333333", 900000003),
    ("مریم", "احمدی", "09124444444", 900000004),
]

DEMO_SERVICES = [
    ("ویزیت عمومی", "معاینه و مشاوره اولیه", 30, 150_000),
    ("ویزیت متخصص", "ویزیت پزشک متخصص", 20, 250_000),
    ("آزمایش خون", "نمونه‌گیری در محل آزمایشگاه", 15, 90_000),
    ("مشاوره تغذیه", "برنامه غذایی اختصاصی", 45, 300_000),
]

DEMO_STAFF = [
    ("دکتر محمدی", "متخصص داخلی", "021-111111"),
    ("دکتر احمدی", "متخصص تغذیه", "021-222222"),
    ("کارشناس رضایی", "کارشناس آزمایشگاه", "021-333333"),
]


def seed() -> None:
    """Insert demo data (idempotent: running it twice does not duplicate)."""
    init_db()
    added = 0
    with session_scope() as session:
        if session.scalar(select(User).where(User.is_demo.is_(True))):
            logger.info("Demo data already exists - nothing to do.")
            print("ℹ️  داده‌های نمونه قبلاً وجود دارد (برای ساخت مجدد ابتدا --clear بزنید).")
            return

        users = []
        for first, last, phone, tg in DEMO_USERS:
            user, _ = user_service.get_or_create(
                session, telegram_id=tg, first_name=first, last_name=last,
                phone=phone, is_demo=True,
            )
            users.append(user)
            added += 1

        services = [
            service_service.create(
                session, name=name, description=desc, duration=dur,
                price=price, is_demo=True,
            )
            for name, desc, dur, price in DEMO_SERVICES
        ]
        added += len(services)

        staff = [
            staff_service.create(
                session, name=name, specialty=spec, phone=phone, is_demo=True
            )
            for name, spec, phone in DEMO_STAFF
        ]
        added += len(staff)

        # M:N relation: every staff member provides at least one service
        staff_service.assign_services(session, staff[0], [services[0].id, services[1].id])
        staff_service.assign_services(session, staff[1], [services[3].id, services[0].id])
        staff_service.assign_services(session, staff[2], [services[2].id])

        # A few appointments in the next days (they really occupy the slots)
        used: set[tuple[int, str, str]] = set()
        for offset in range(1, 6):
            day = tehran_today() + timedelta(days=offset)
            for member in staff:
                free = [
                    slot for slot in _slots_for(session, member.id, day)
                    if (member.id, day.isoformat(), slot) not in used
                ]
                if not free:
                    continue
                start = free[0]
                hour, minute = (int(part) for part in start.split(":"))
                try:
                    appointment_service.create_appointment(
                        session,
                        user=random.choice(users),
                        service_id=member.services[0].id,
                        staff_id=member.id,
                        day=day,
                        start=time(hour, minute),
                        note="نوبت نمونه",
                    )
                    used.add((member.id, day.isoformat(), start))
                    added += 1
                except appointment_service.BookingError:  # pragma: no cover
                    continue

    print(f"✅ {added} رکورد نمونه ساخته شد.")


def _slots_for(session, staff_id: int, day) -> list[str]:
    from services import slot_service

    member = session.get(Staff, staff_id)
    if member is None or not member.services:
        return []
    return slot_service.get_available_slots(
        session, staff_id=staff_id, service_id=member.services[0].id, day=day
    )


def clear() -> None:
    """Delete only the rows created by :func:`seed` (is_demo = True)."""
    init_db()
    removed = 0
    with session_scope() as session:
        demo_users = list(session.scalars(select(User).where(User.is_demo.is_(True))))
        demo_staff = list(session.scalars(select(Staff).where(Staff.is_demo.is_(True))))
        demo_services = list(
            session.scalars(select(Service).where(Service.is_demo.is_(True)))
        )
        user_ids = [row.id for row in demo_users]
        staff_ids = [row.id for row in demo_staff]
        service_ids = [row.id for row in demo_services]

        def _ids(values: list[int]) -> list[int]:
            return values or [-1]

        # 1) every appointment that touches demo data (users / staff / services)
        appointments = session.scalars(
            select(Appointment).where(
                or_(
                    Appointment.user_id.in_(_ids(user_ids)),
                    Appointment.staff_id.in_(_ids(staff_ids)),
                    Appointment.service_id.in_(_ids(service_ids)),
                )
            )
        ).all()
        # 2) waitlist rows of demo users / staff / services
        waiting = session.scalars(
            select(Waitlist).where(
                or_(
                    Waitlist.user_id.in_(_ids(user_ids)),
                    Waitlist.staff_id.in_(_ids(staff_ids)),
                    Waitlist.service_id.in_(_ids(service_ids)),
                )
            )
        ).all()
        # 3) support tickets and notifications of demo users
        tickets = session.scalars(
            select(SupportTicket).where(SupportTicket.user_id.in_(_ids(user_ids)))
        ).all()
        notes = session.scalars(
            select(Notification).where(Notification.user_id.in_(_ids(user_ids)))
        ).all()

        for row in [*appointments, *waiting, *tickets, *notes]:
            session.delete(row)
            removed += 1

        # 4) break the M:N links, then remove the demo rows themselves
        for member in demo_staff:
            member.services = []
        for service in demo_services:
            service.staff = []
        for row in [*demo_users, *demo_staff, *demo_services]:
            session.delete(row)
            removed += 1

    print(f"🗑 {removed} رکورد نمونه حذف شد.")


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(description="Demo data for the appointment bot")
    parser.add_argument("--clear", action="store_true", help="remove the demo data")
    args = parser.parse_args()
    clear() if args.clear else seed()


if __name__ == "__main__":
    main()
