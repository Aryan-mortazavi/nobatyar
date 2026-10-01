"""
Keyboards of the customer-facing bot.

Every button label comes from the web app (``channel.*`` in its dictionary) so
the product speaks with one voice. The fallbacks are only used if the API is
unreachable — a bot that shows an empty menu is worse than one that shows a
slightly stale label.
"""

from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from channel.api import Appointment, Catalogue, DaySummary, Service, Slot
from channel.text import appointment_card, duration, service_line

# Fallbacks, used only when the web app cannot be reached.
FALLBACK = {
    "book": "🗓 رزرو نوبت جدید",
    "myAppointments": "📋 نوبت‌های من",
    "myPackages": "🎁 بسته‌های من",
    "support": "💬 پشتیبانی",
    "website": "🌐 رزرو در وب‌سایت",
    "back": "بازگشت",
    "next": "بعدی",
    "previous": "قبلی",
    "cancel": "❌ انصراف",
}


def _label(catalogue: Catalogue | None, key: str) -> str:
    if catalogue is not None:
        value = catalogue.label(key, "")
        if value:
            return value
    return FALLBACK.get(key, key)


# ---------------------------------------------------------------------------
# Reply keyboard (the persistent menu under the input box)
# ---------------------------------------------------------------------------
def _markup(builder: ReplyKeyboardBuilder) -> ReplyKeyboardMarkup:
    return builder.as_markup(resize_keyboard=True, input_field_placeholder="پیام خود را بنویسید...")


def main_menu(catalogue: Catalogue | None = None) -> ReplyKeyboardMarkup:
    """The home screen: book, my appointments, packages, support."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=_label(catalogue, "book"))
    builder.button(text=_label(catalogue, "myAppointments"))
    builder.row(
        KeyboardButton(text=_label(catalogue, "myPackages")),
        KeyboardButton(text=_label(catalogue, "support")),
    )
    builder.adjust(1, 1, 2)
    return _markup(builder)


def cancel_keyboard(catalogue: Catalogue | None = None) -> ReplyKeyboardMarkup:
    """Escape hatch shown during every multi-step flow."""
    builder = ReplyKeyboardBuilder()
    builder.button(text=FALLBACK["cancel"])
    builder.adjust(1)
    return _markup(builder)


def contact_keyboard(catalogue: Catalogue | None = None) -> ReplyKeyboardMarkup:
    """Registration: let Telegram fill the phone number, or type it."""
    builder = ReplyKeyboardBuilder()
    builder.button(text="📱 ارسال شماره تماس من", request_contact=True)
    builder.button(text=FALLBACK["cancel"])
    builder.adjust(1, 1)
    return _markup(builder)


def remove() -> ReplyKeyboardRemove:
    """Hide the reply keyboard (right after identification)."""
    return ReplyKeyboardRemove()


# ---------------------------------------------------------------------------
# Inline keyboards (the wizard)
# ---------------------------------------------------------------------------
def services_menu(catalogue: Catalogue, currency: str = "IRT") -> InlineKeyboardMarkup:
    """Step 1 — pick a service. Two per row keeps the list scannable."""
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for service in catalogue.services:
        row.append(
            InlineKeyboardButton(
                text=service_line(service, currency),
                callback_data=f"svc:{service.id}",
            )
        )
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def staff_menu(
    catalogue: Catalogue, service: Service, has_branches: bool = False
) -> InlineKeyboardMarkup:
    """Step 2 — pick a specialist, or take the earliest free slot."""
    buttons: list[list[InlineKeyboardButton]] = [
        [InlineKeyboardButton(text=f"⚡️ {_label(catalogue, 'anyStaff')}", callback_data="stf:any")]
    ]
    row: list[InlineKeyboardButton] = []
    for member in catalogue.staff_for(service.id):
        row.append(
            InlineKeyboardButton(text=member.name, callback_data=f"stf:{member.id}")
        )
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append(
        [
            InlineKeyboardButton(
                text=_label(catalogue, "website"), callback_data="web:service"
            ),
            InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def date_menu(
    days: list[DaySummary],
    *,
    page: int = 0,
    per_page: int = 10,
    has_next: bool = False,
    today_label: str = "امروز",
) -> InlineKeyboardMarkup:
    """Step 3 — the next bookable days, five per row."""
    window = days[page * per_page : (page + 1) * per_page]
    buttons: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for day in window:
        row.append(
            InlineKeyboardButton(
                text=f"{day.date[-5:].replace('-', '/')} · {duration(day.free_count)}",
                callback_data=f"day:{day.date}",
            )
        )
        if len(row) == 5:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)

    navigation: list[InlineKeyboardButton] = []
    if page > 0:
        navigation.append(InlineKeyboardButton(text="◀️ قبلی", callback_data=f"date:page:{page - 1}"))
    if has_next:
        navigation.append(InlineKeyboardButton(text="بعدی ▶️", callback_data=f"date:page:{page + 1}"))
    if navigation:
        buttons.append(navigation)
    buttons.append([InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def time_menu(slots: list[Slot], service_id: str, staff_id: str, date: str) -> InlineKeyboardMarkup:
    """Step 4 — free times only; three per row."""
    free = [slot for slot in slots if slot.available]
    buttons: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for slot in free:
        row.append(
            InlineKeyboardButton(
                text=slot.label,
                callback_data=f"slot:{service_id}:{staff_id}:{date}:{slot.start}",
            )
        )
        if len(row) == 3:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append(
        [
            InlineKeyboardButton(text="🔙 تغییر تاریخ", callback_data="back:date"),
            InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def confirm_menu(
    *, service_id: str, staff_id: str, start: int, has_bundle: bool = False
) -> InlineKeyboardMarkup:
    """Step 5 — the summary with the final yes/no, plus the web hand-off."""
    buttons = [
        [InlineKeyboardButton(text="✅ تأیید و ثبت نهایی", callback_data=f"book:{service_id}:{staff_id}:{start}")],
    ]
    if has_bundle:
        buttons.append(
            [InlineKeyboardButton(text="🎁 مصرف یک جلسه از بستهٔ من", callback_data=f"book:bundle:{service_id}:{staff_id}:{start}")]
        )
    buttons.append(
        [
            InlineKeyboardButton(text="🔙 تغییر ساعت", callback_data="back:time"),
            InlineKeyboardButton(text="🌐 رزرو در وب‌سایت", callback_data="web:service"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def my_appointments_menu(appointments: list[Appointment]) -> InlineKeyboardMarkup:
    """List the customer's appointments; cancellable ones get a button."""
    buttons: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for appointment in appointments:
        row.append(
            InlineKeyboardButton(
                text=f"{appointment.when_text[-5:]} · {appointment.service_title[:18]}",
                callback_data=f"appt:{appointment.tracking_code}",
            )
        )
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append(
        [
            InlineKeyboardButton(text="🔄 نوبت‌های گذشته", callback_data="appts:history"),
            InlineKeyboardButton(text="🗓 نوبت جدید", callback_data="book:new"),
            InlineKeyboardButton(text="🏠 منوی اصلی", callback_data="menu:home"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def appointment_detail_menu(appointment: Appointment) -> InlineKeyboardMarkup:
    """Detail view: cancel (when allowed) and the web hand-off."""
    buttons: list[list[InlineKeyboardButton]] = []
    if appointment.cancellable:
        buttons.append(
            [
                InlineKeyboardButton(
                    text="🗑 لغو این نوبت", callback_data=f"cancel:{appointment.tracking_code}"
                )
            ]
        )
    buttons.append(
        [
            InlineKeyboardButton(
                text="🌐 مشاهده در وب‌سایت", url=appointment.web_url or "https://example.com"
            ),
            InlineKeyboardButton(text="🔙 بازگشت", callback_data="appts:upcoming"),
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def confirmation_card(appointment: Appointment) -> str:
    """The text shown just before the customer commits."""
    return (
        "🧾 لطفاً اطلاعات نوبت را بررسی کنید:\n\n"
        f"{appointment_card(appointment)}\n\n"
        "با «تأیید و ثبت نهایی» نوبت رزرو می‌شود."
    )


__all__ = [
    "FALLBACK",
    "appointment_detail_menu",
    "cancel_keyboard",
    "confirm_menu",
    "confirmation_card",
    "contact_keyboard",
    "date_menu",
    "main_menu",
    "my_appointments_menu",
    "remove",
    "services_menu",
    "staff_menu",
    "time_menu",
]
