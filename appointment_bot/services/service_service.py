"""Service catalog CRUD (name, description, duration, price, active flag)."""

from __future__ import annotations

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import Service, Staff


class ServiceError(ValueError):
    """Raised when a service operation is not allowed (message is Persian)."""


def list_services(
    session: Session, *, active_only: bool = False, search: str | None = None
) -> list[Service]:
    stmt = select(Service)
    if active_only:
        stmt = stmt.where(Service.is_active.is_(True))
    if search:
        stmt = stmt.where(Service.name.like(f"%{search.strip()}%"))
    stmt = stmt.order_by(Service.id)
    return list(session.scalars(stmt))


def get(session: Session, service_id: int) -> Service | None:
    return session.get(Service, service_id)


def get_active(session: Session, service_id: int) -> Service:
    """Return the service only if it exists and is active."""
    service = session.get(Service, service_id)
    if service is None:
        raise ServiceError("❌ خدمت موردنظر یافت نشد.")
    if not service.is_active:
        raise ServiceError("❌ این خدمت در حال حاضر غیرفعال است.")
    return service


def create(
    session: Session,
    *,
    name: str,
    description: str = "",
    duration: int = 30,
    price: int = 0,
    is_active: bool = True,
    is_demo: bool = False,
) -> Service:
    """Create a service (duration in minutes, price is informational only)."""
    name = name.strip()
    if not name:
        raise ServiceError("❌ نام خدمت نمی‌تواند خالی باشد.")
    if session.scalar(select(Service).where(Service.name == name)):
        raise ServiceError("❌ خدمتی با این نام از قبل وجود دارد.")
    if duration <= 0:
        raise ServiceError("❌ مدت زمان خدمت باید بزرگ‌تر از صفر باشد.")

    service = Service(
        name=name,
        description=description.strip(),
        duration=duration,
        price=max(0, price),
        is_active=is_active,
        is_demo=is_demo,
    )
    session.add(service)
    session.flush()
    return service


def update(session: Session, service: Service, **fields) -> Service:
    """Update any subset of: name, description, duration, price, is_active."""
    if "name" in fields and fields["name"]:
        new_name = fields["name"].strip()
        clash = session.scalar(select(Service).where(Service.name == new_name))
        if clash is not None and clash.id != service.id:
            raise ServiceError("❌ خدمتی با این نام از قبل وجود دارد.")
        service.name = new_name
    if "description" in fields and fields["description"] is not None:
        service.description = fields["description"].strip()
    if "duration" in fields and fields["duration"] is not None:
        if int(fields["duration"]) <= 0:
            raise ServiceError("❌ مدت زمان خدمت باید بزرگ‌تر از صفر باشد.")
        service.duration = int(fields["duration"])
    if "price" in fields and fields["price"] is not None:
        service.price = max(0, int(fields["price"]))
    if "is_active" in fields and fields["is_active"] is not None:
        service.is_active = bool(fields["is_active"])
    session.flush()
    return service


def set_active(session: Session, service: Service, active: bool) -> None:
    service.is_active = active
    session.flush()


def delete(session: Session, service: Service) -> None:
    """
    Delete a service. Appointments that reference it are checked first so we
    never silently destroy historical data.

    All the checks are plain SELECTs (never a cached relationship): sessions
    are created with ``expire_on_commit=False``, so an eagerly loaded
    collection may be stale and would silently let a bad delete through.
    """
    from database.models import Appointment, StaffService, Waitlist

    used = session.scalar(
        select(Appointment.id).where(Appointment.service_id == service.id).limit(1)
    )
    if used is not None:
        raise ServiceError(
            "❌ برای این خدمت نوبت ثبت شده است؛ ابتدا آن را غیرفعال کنید."
        )
    # Waitlist rows also reference the service -> block instead of failing on FK
    waiting = session.scalar(
        select(Waitlist.id).where(Waitlist.service_id == service.id).limit(1)
    )
    if waiting is not None:
        raise ServiceError(
            "❌ کاربرانی در لیست انتظار این خدمت هستند؛ ابتدا آن‌ها را حذف کنید."
        )
    # drop the M:N links first (the FK would block the delete otherwise)
    session.execute(
        sa_delete(StaffService).where(StaffService.service_id == service.id)
    )
    service.staff.clear()  # keep the in-memory collection in sync
    session.delete(service)
    session.flush()


def staff_for_service(session: Session, service_id: int) -> list[Staff]:
    """Only the staff members that actually provide this service."""
    from database.models import StaffService

    rows = session.scalars(
        select(Staff)
        .join(StaffService, StaffService.staff_id == Staff.id)
        .where(StaffService.service_id == service_id, Staff.is_active.is_(True))
        .order_by(Staff.id)
    )
    return list(rows)


def services_of_staff(session: Session, staff_id: int) -> list[Service]:
    from database.models import StaffService

    rows = session.scalars(
        select(Service)
        .join(StaffService, StaffService.service_id == Service.id)
        .where(StaffService.staff_id == staff_id)
        .order_by(Service.id)
    )
    return list(rows)
