"""
FSM states (aiogram).

Every multi-step conversation lives here so all handler modules can share the
same states without importing each other.

Registration : name -> last name -> phone
Booking      : service -> staff -> date -> time -> confirm
Reschedule   : pick appointment -> date -> time -> confirm
Support      : free text message
Admin*       : the data-entry forms of the admin panel
"""

from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class Registration(StatesGroup):
    first_name = State()
    last_name = State()
    phone = State()


class Booking(StatesGroup):
    service = State()
    staff = State()
    date = State()
    time = State()
    confirm = State()


class Reschedule(StatesGroup):
    date = State()
    time = State()
    confirm = State()


class Support(StatesGroup):
    message = State()


class ProfileEdit(StatesGroup):
    first_name = State()
    last_name = State()
    phone = State()


class AdminReply(StatesGroup):
    message = State()


class AdminServiceForm(StatesGroup):
    """Add a service / edit one of its fields."""

    name = State()
    description = State()
    duration = State()
    price = State()
    field = State()  # editing an existing service: which field is being typed


class AdminStaffForm(StatesGroup):
    name = State()
    specialty = State()
    phone = State()
    field = State()


class AdminHourForm(StatesGroup):
    """Set the working hours of one weekday: start then end."""

    start = State()
    end = State()


class AdminBreakForm(StatesGroup):
    day = State()
    start = State()
    end = State()


class AdminHolidayForm(StatesGroup):
    date = State()
    note = State()


class AdminUserSearch(StatesGroup):
    query = State()


class AdminSettingsForm(StatesGroup):
    key = State()
    value = State()


class AdminReportForm(StatesGroup):
    date = State()


class AdminDateFilter(StatesGroup):
    """Admin appointment list: 'filter by date' input."""
    date = State()



class AdminTicketReply(StatesGroup):
    message = State()


# ---------------------------------------------------------------------------
# "Back" navigation map used by the shared back handler
# ---------------------------------------------------------------------------
PREVIOUS_STATE: dict[type[StatesGroup], State] = {
    Registration.last_name: Registration.first_name,
    Registration.phone: Registration.last_name,
    Booking.staff: Booking.service,
    Booking.date: Booking.staff,
    Booking.time: Booking.date,
    Booking.confirm: Booking.time,
    Reschedule.time: Reschedule.date,
    Reschedule.confirm: Reschedule.time,
}
