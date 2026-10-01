"""
Database models (SQLAlchemy 2.0 "typed" style).

Relationships
-------------
User      1 --- * Appointment * --- 1 Service
Staff     1 --- * Appointment
Staff     * --- * Service          (through the StaffService association)
Staff     1 --- * WorkingHour
Staff     1 --- * BreakTime
User      1 --- * Waitlist / SupportTicket / Notification
Holiday   : standalone table (one row per closed day)
Setting   : standalone table (key / value pairs)
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database.session import Base


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class User(Base):
    """A Telegram user that finished the registration flow."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64), default="")
    phone: Mapped[str] = mapped_column(String(20), default="")
    role: Mapped[str] = mapped_column(String(20), default="user", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    waitlist_entries: Mapped[list["Waitlist"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    tickets: Mapped[list["SupportTicket"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


# ---------------------------------------------------------------------------
# Catalog: services & staff
# ---------------------------------------------------------------------------
class Service(Base):
    """A bookable service (price is informational only - no payments)."""

    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[int] = mapped_column(Integer, default=30)  # minutes
    price: Mapped[int] = mapped_column(Integer, default=0)  # informational only
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    staff: Mapped[list["Staff"]] = relationship(
        secondary="staff_services", back_populates="services", lazy="selectin"
    )
    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="service", lazy="selectin"
    )


class Staff(Base):
    """A specialist / employee that receives appointments."""

    __tablename__ = "staffs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    specialty: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(20), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    services: Mapped[list[Service]] = relationship(
        secondary="staff_services", back_populates="staff", lazy="selectin"
    )
    working_hours: Mapped[list["WorkingHour"]] = relationship(
        back_populates="staff", cascade="all, delete-orphan", lazy="selectin"
    )
    breaks: Mapped[list["BreakTime"]] = relationship(
        back_populates="staff", cascade="all, delete-orphan", lazy="selectin"
    )
    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="staff", lazy="selectin"
    )
    waitlist_entries: Mapped[list["Waitlist"]] = relationship(
        back_populates="staff", cascade="all, delete-orphan", lazy="selectin"
    )


class StaffService(Base):
    """Many-to-many association: which staff member provides which service."""

    __tablename__ = "staff_services"
    __table_args__ = (UniqueConstraint("staff_id", "service_id", name="uq_staff_service"),)

    staff_id: Mapped[int] = mapped_column(
        ForeignKey("staffs.id", ondelete="CASCADE"), primary_key=True
    )
    service_id: Mapped[int] = mapped_column(
        ForeignKey("services.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Working schedule
# ---------------------------------------------------------------------------
class WorkingHour(Base):
    """
    Weekly working hours of a staff member.

    day_of_week uses the Persian week: 0 = Saturday ... 6 = Friday.
    """

    __tablename__ = "working_hours"
    __table_args__ = (
        UniqueConstraint(
            "staff_id", "day_of_week", "start_time", name="uq_working_hour"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(
        ForeignKey("staffs.id", ondelete="CASCADE"), index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer)  # 0=Saturday ... 6=Friday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    staff: Mapped[Staff] = relationship(back_populates="working_hours")


class BreakTime(Base):
    """Rest / break interval of a staff member (no booking allowed)."""

    __tablename__ = "break_times"

    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(
        ForeignKey("staffs.id", ondelete="CASCADE"), index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    staff: Mapped[Staff] = relationship(back_populates="breaks")


class Holiday(Base):
    """A closed day (no appointments at all)."""

    __tablename__ = "holidays"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    note: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Appointments
# ---------------------------------------------------------------------------
class Appointment(Base):
    """
    One booked appointment.

    ``slot_key`` is the heart of the double-booking protection:
    it is unique in the whole table while the appointment is active and is set
    back to NULL as soon as the appointment is cancelled (which frees the slot).
    """

    __tablename__ = "appointments"

    STATUSES = ("pending", "confirmed", "cancelled", "completed", "no_show")

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    staff_id: Mapped[int] = mapped_column(ForeignKey("staffs.id"), index=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    tracking_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    slot_key: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(Text, default="")
    # Reminder flags avoid sending the same reminder twice
    reminder_24h_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_1h_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship(back_populates="appointments", lazy="selectin")
    staff: Mapped[Staff] = relationship(back_populates="appointments", lazy="selectin")
    service: Mapped[Service] = relationship(
        back_populates="appointments", lazy="selectin"
    )

    @staticmethod
    def build_slot_key(staff_id: int, day: date, start: time) -> str:
        """Unique key of a slot -> 'staff:date:time'."""
        return f"{staff_id}:{day.isoformat()}:{start.strftime('%H:%M')}"


# ---------------------------------------------------------------------------
# Waitlist & support
# ---------------------------------------------------------------------------
class Waitlist(Base):
    """A user waiting for a free slot on a specific day."""

    __tablename__ = "waitlist"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "staff_id", "date", "preferred_time", name="uq_waitlist_entry"
        ),
    )

    STATUSES = ("pending", "notified", "booked", "cancelled", "expired")

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    staff_id: Mapped[int] = mapped_column(ForeignKey("staffs.id"), index=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    preferred_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship(back_populates="waitlist_entries", lazy="selectin")
    staff: Mapped[Staff] = relationship(back_populates="waitlist_entries", lazy="selectin")
    service: Mapped[Service] = relationship(lazy="selectin")


class SupportTicket(Base):
    """A message the user sent to the support team."""

    __tablename__ = "support_tickets"

    STATUSES = ("open", "answered", "closed")

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    message: Mapped[str] = mapped_column(Text)
    admin_reply: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped[User] = relationship(back_populates="tickets", lazy="selectin")


class Notification(Base):
    """Persisted copy of every message the system sent to a user."""

    __tablename__ = "notifications"

    TYPES = (
        "appointment_created",
        "appointment_confirmed",
        "appointment_cancelled",
        "appointment_rescheduled",
        "appointment_reminder",
        "waitlist_available",
        "admin_message",
        "support_reply",
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    is_sent: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped[User] = relationship(back_populates="notifications")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class Setting(Base):
    """Global key/value settings edited from both admin panels."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
