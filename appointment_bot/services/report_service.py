"""
Reporting: daily and monthly statistics shown in both admin panels.

Monthly reports follow the Jalali calendar (month 1..12 of the Persian year)
because that is what the users of this system understand.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database.models import Appointment, Service, Staff, User
from database.queries import filter_appointments
from utils.calendar import jalali_month_bounds, persian_weekday, tehran_tz, to_jalali
from utils.constants import APPOINTMENT_STATUSES, PERSIAN_DAYS, STATUS_LABELS_FA

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def _status_counts(session: Session, start: date, end: date) -> dict[str, int]:
    rows = session.execute(
        select(Appointment.status, func.count(Appointment.id)).where(
            Appointment.date >= start, Appointment.date <= end
        ).group_by(Appointment.status)
    ).all()
    counts = {status: 0 for status in APPOINTMENT_STATUSES}
    for status, count in rows:
        counts[status] = count
    return counts


def daily_report(
    session: Session, day: date, *, staff_id: int | None = None,
    service_id: int | None = None, status: str | None = None,
) -> dict:
    """Everything that happened (or is planned) on one day."""
    appointments = filter_appointments(
        session, day=day, staff_id=staff_id, service_id=service_id, status=status
    )
    counts = _status_counts(session, day, day)
    counts["total"] = len(appointments)
    counts["active"] = counts["pending"] + counts["confirmed"]
    return {
        "day": day,
        "label": f"{to_jalali(day)} ({PERSIAN_DAYS[persian_weekday(day)]})",
        "counts": counts,
        "appointments": appointments,
    }


def monthly_report(session: Session, year: int, month: int) -> dict:
    """One Jalali month: totals, new users, top services and staff load."""
    start, end = jalali_month_bounds(year, month)
    counts = _status_counts(session, start, end)

    total = sum(counts.values())

    # New users registered during that month (created_at is stored as UTC)
    start_utc = datetime.combine(start, time.min, tzinfo=tehran_tz()).astimezone(timezone.utc)
    end_utc = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tehran_tz()).astimezone(
        timezone.utc
    )
    new_users = (
        session.scalar(
            select(func.count(User.id)).where(
                User.created_at >= start_utc.replace(tzinfo=None),
                User.created_at < end_utc.replace(tzinfo=None),
            )
        )
        or 0
    )

    top_services = session.execute(
        select(Service.name, func.count(Appointment.id))
        .join(Appointment, Appointment.service_id == Service.id)
        .where(
            Appointment.date >= start,
            Appointment.date <= end,
            Appointment.status != "cancelled",
        )
        .group_by(Service.id, Service.name)
        .order_by(func.count(Appointment.id).desc())
        .limit(5)
    ).all()

    per_staff = session.execute(
        select(Staff.name, func.count(Appointment.id))
        .join(Appointment, Appointment.staff_id == Staff.id)
        .where(
            Appointment.date >= start,
            Appointment.date <= end,
            Appointment.status != "cancelled",
        )
        .group_by(Staff.id, Staff.name)
        .order_by(func.count(Appointment.id).desc())
    ).all()

    return {
        "year": year,
        "month": month,
        "start": start,
        "end": end,
        "label": f"{to_jalali(start)} تا {to_jalali(end)}",
        "counts": counts,
        "total": total,
        "new_users": new_users,
        "top_services": top_services,
        "per_staff": per_staff,
    }


# ---------------------------------------------------------------------------
# Text formatting (Telegram)
# ---------------------------------------------------------------------------
def format_daily(report: dict) -> str:
    counts = report["counts"]
    lines = [
        "━━━━━━━━━━━━━━",
        f"📈 گزارش روزانه {report['label']}",
        "━━━━━━━━━━━━━━",
        f"کل نوبت‌ها: {counts['total']}",
        f"فعال (در انتظار + تأیید شده): {counts['active']}",
        f"انجام شده: {counts['completed']}",
        f"لغو شده: {counts['cancelled']}",
        f"عدم مراجعه: {counts['no_show']}",
        "━━━━━━━━━━━━━━",
    ]
    if report["appointments"]:
        lines.append("لیست نوبت‌ها:")
        for appt in report["appointments"][:10]:
            lines.append(
                f"  • {appt.start_time.strftime('%H:%M')} - {appt.tracking_code} "
                f"({STATUS_LABELS_FA.get(appt.status, appt.status)})"
            )
    return "\n".join(lines)


def format_monthly(report: dict) -> str:
    counts = report["counts"]
    lines = [
        "━━━━━━━━━━━━━━",
        "📈 گزارش ماهانه",
        f"📅 {report['label']}",
        "━━━━━━━━━━━━━━",
        f"کل نوبت‌ها: {report['total']}",
        f"کاربران جدید: {report['new_users']}",
        f"انجام شده: {counts['completed']}",
        f"لغو شده: {counts['cancelled']}",
        f"عدم مراجعه: {counts['no_show']}",
    ]
    if report["top_services"]:
        lines.append("\n⭐ پرطرفدارترین خدمات:")
        for name, count in report["top_services"]:
            lines.append(f"  • {name}: {count} نوبت")
    if report["per_staff"]:
        lines.append("\n🧑‍💼 نوبت‌ها به تفکیک کارشناس:")
        for name, count in report["per_staff"]:
            lines.append(f"  • {name}: {count} نوبت")
    lines.append("━━━━━━━━━━━━━━")
    return "\n".join(lines)
