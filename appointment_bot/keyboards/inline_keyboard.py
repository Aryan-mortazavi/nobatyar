"""
Inline keyboards.

Callback-data convention (Telegram limits callback_data to 64 bytes):

    book:service:<id>       choose a service
    book:staff:<id>         choose a staff member
    cal:nav:<y>:<m>         move the Jalali calendar
    cal:day:<y>:<m>:<d>     pick a day
    slot:<HHMM>             pick a free slot        (slot:0930)
    slotfull:<HHMM>         a full slot -> waitlist (slotfull:0930)
    wl:yes / wl:no          join the waitlist or not
    appt:<id> / appt:cancel:<id> / appt:resched:<id>
    my:<tab>:<page>         my appointments tabs
    adm:*                   admin panel actions
"""

from __future__ import annotations

from datetime import date

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from utils.calendar import month_matrix, month_title, next_month, prev_month
from utils.constants import TAB_CANCELLED, TAB_LABELS_FA, TAB_PAST, TAB_UPCOMING


def from_rows(rows: list[list[InlineKeyboardButton]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=rows)


def simple(buttons: list[tuple[str, str]], width: int = 1) -> InlineKeyboardMarkup:
    """[(text, callback), ...] grouped in rows of `width`."""
    rows: list[list[InlineKeyboardButton]] = []
    for i in range(0, len(buttons), width):
        rows.append(
            [InlineKeyboardButton(text=t, callback_data=c) for t, c in buttons[i:i + width]]
        )
    return from_rows(rows)


def noop_button(text: str = " ") -> InlineKeyboardButton:
    """A button that does nothing (used for layout / titles)."""
    return InlineKeyboardButton(text=text, callback_data="noop")


def noop(text: str = " ") -> InlineKeyboardMarkup:
    return from_rows([[noop_button(text)]])


def confirm(prefix: str, *, yes: str = "✅ تأیید", no: str = "❌ انصراف") -> InlineKeyboardMarkup:
    """Two buttons: `<prefix>:yes` and `<prefix>:no`."""
    return from_rows([[
        InlineKeyboardButton(text=yes, callback_data=f"{prefix}:yes"),
        InlineKeyboardButton(text=no, callback_data=f"{prefix}:no"),
    ]])


def pagination(prefix: str, page: int, total_pages: int) -> list[InlineKeyboardButton]:
    """⬅️ Previous | Page x/y | Next ➡️ (a single row)."""
    row: list[InlineKeyboardButton] = []
    if page > 1:
        row.append(InlineKeyboardButton(text="⬅️ قبلی", callback_data=f"{prefix}:{page - 1}"))
    row.append(InlineKeyboardButton(text=f"صفحه {page}/{total_pages}", callback_data="noop"))
    if page < total_pages:
        row.append(InlineKeyboardButton(text="بعدی ➡️", callback_data=f"{prefix}:{page + 1}"))
    return row


# ---------------------------------------------------------------------------
# Booking flow
# ---------------------------------------------------------------------------
def services(services, prefix: str = "book:service") -> InlineKeyboardMarkup:
    """List of bookable services."""
    rows = [
        [InlineKeyboardButton(text=f"🛠 {svc.name}", callback_data=f"{prefix}:{svc.id}")]
        for svc in services
    ]
    return from_rows(rows)


def staff(staff_list, prefix: str = "book:staff") -> InlineKeyboardMarkup:
    """Staff members that provide the selected service."""
    rows = []
    for member in staff_list:
        label = f"🧑‍💼 {member.name}"
        if member.specialty:
            label += f" ({member.specialty})"
        rows.append([InlineKeyboardButton(text=label, callback_data=f"{prefix}:{member.id}")])
    return from_rows(rows)


def calendar(
    year: int,
    month: int,
    bookable: set[date],
    *,
    nav_prefix: str = "cal:nav",
    day_prefix: str = "cal:day",
    back: tuple[str, str] | None = None,
) -> InlineKeyboardMarkup:
    """
    Jalali month view.

    Only bookable days are clickable; holidays, past days and closed days are
    not rendered as buttons at all.
    """
    rows: list[list[InlineKeyboardButton]] = []

    prev_y, prev_m = prev_month(year, month)
    next_y, next_m = next_month(year, month)
    rows.append([
        InlineKeyboardButton(text="➡️ ماه قبل", callback_data=f"{nav_prefix}:{prev_y}:{prev_m}"),
        InlineKeyboardButton(text=month_title(year, month), callback_data="noop"),
        InlineKeyboardButton(text="ماه بعد ⬅️", callback_data=f"{nav_prefix}:{next_y}:{next_m}"),
    ])

    # Weekday header: شنبه ... جمعه
    rows.append(
        [noop_button(name) for name in ("شنب", "یکش", "دوش", "سهش", "چهار", "پنج", "جمعه")]
    )

    for week in month_matrix(year, month):
        row: list[InlineKeyboardButton] = []
        for day_number in week:
            if day_number is None:
                row.append(noop_button("·"))
                continue
            gregorian = _to_gregorian(year, month, day_number)
            if gregorian in bookable:
                row.append(
                    InlineKeyboardButton(
                        text=str(day_number),
                        callback_data=f"{day_prefix}:{year}:{month}:{day_number}",
                    )
                )
            else:
                row.append(noop_button("·"))
        rows.append(row)

    if back:
        rows.append([InlineKeyboardButton(text=back[0], callback_data=back[1])])
    return from_rows(rows)


def _to_gregorian(year: int, month: int, day: int) -> date:
    import jdatetime

    return jdatetime.date(year, month, day).togregorian()


def slots(slot_items, prefix: str = "slot") -> InlineKeyboardMarkup:
    """
    Time slots of one day.

    * free slot   -> 09:00           (bookable)
    * booked slot -> 09:00 🔒        (clicking it offers the waitlist)

    ``prefix`` lets the reschedule flow reuse the same keyboard with its own
    callback names (res:slot / res:slotfull).
    """
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for slot in slot_items:
        key = slot.time.replace(":", "")
        if slot.available:
            button = InlineKeyboardButton(text=slot.time, callback_data=f"{prefix}:{key}")
        else:
            button = InlineKeyboardButton(
                text=f"{slot.time} 🔒", callback_data=f"{prefix}full:{key}"
            )
        row.append(button)
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return from_rows(rows)


# ---------------------------------------------------------------------------
# My appointments
# ---------------------------------------------------------------------------
def appointment_tabs(tab: str, page: int = 1) -> InlineKeyboardMarkup:
    """Upcoming / Past / Cancelled tabs + pagination."""
    rows = [[
        InlineKeyboardButton(
            text=("✅ " if tab == TAB_UPCOMING else "") + TAB_LABELS_FA[TAB_UPCOMING],
            callback_data=f"my:{TAB_UPCOMING}:1",
        ),
        InlineKeyboardButton(
            text=("✅ " if tab == TAB_PAST else "") + TAB_LABELS_FA[TAB_PAST],
            callback_data=f"my:{TAB_PAST}:1",
        ),
        InlineKeyboardButton(
            text=("✅ " if tab == TAB_CANCELLED else "") + TAB_LABELS_FA[TAB_CANCELLED],
            callback_data=f"my:{TAB_CANCELLED}:1",
        ),
    ]]
    return from_rows(rows)


def appointment_item(appointment_id: int, label: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text=label, callback_data=f"appt:{appointment_id}")


def appointment_actions(
    appointment_id: int, *, can_cancel: bool, can_reschedule: bool
) -> InlineKeyboardMarkup:
    """Detail view of one appointment."""
    rows: list[list[InlineKeyboardButton]] = []
    actions: list[InlineKeyboardButton] = []
    if can_reschedule:
        actions.append(
            InlineKeyboardButton(text="🔄 تغییر وقت", callback_data=f"appt:resched:{appointment_id}")
        )
    if can_cancel:
        actions.append(
            InlineKeyboardButton(text="❌ لغو نوبت", callback_data=f"appt:cancelask:{appointment_id}")
        )
    if actions:
        rows.append(actions)
    rows.append([InlineKeyboardButton(text="🔙 بازگشت", callback_data="my:upcoming:1")])
    return from_rows(rows)


# ---------------------------------------------------------------------------
# Waitlist / misc
# ---------------------------------------------------------------------------
def waitlist_prompt() -> InlineKeyboardMarkup:
    return from_rows([[
        InlineKeyboardButton(text="✅ عضویت در لیست انتظار", callback_data="wl:yes"),
        InlineKeyboardButton(text="❌ خیر", callback_data="wl:no"),
    ]])


def waitlist_offer(entry_id: int) -> InlineKeyboardMarkup:
    return from_rows([[
        InlineKeyboardButton(text="✅ رزرو این ساعت", callback_data=f"wlbook:{entry_id}"),
        InlineKeyboardButton(text="❌ بعداً", callback_data="noop"),
    ]])


def back_to_menu() -> InlineKeyboardMarkup:
    return from_rows([[
        InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home"),
    ]])
