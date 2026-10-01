"""
📅 مدیریت نوبت‌ها (admin)

    filters: today / future / all / by staff / by status / by date
    detail view with the four status actions
    every status change notifies the user (and frees the slot on cancel)
"""

from __future__ import annotations

import logging
from datetime import date

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.models import Appointment, User
from database.queries import filter_appointments
from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminDateFilter
from keyboards.inline_keyboard import from_rows
from services import appointment_service, notification_service, staff_service, user_service
from utils.calendar import day_name, tehran_today, to_jalali
from utils.constants import (
    APPOINTMENT_STATUSES,
    BTN_ADMIN_APPOINTMENTS,
    DIVIDER,
    PAGE_SIZE_TELEGRAM,
    STATUS_LABELS_FA,
)
from utils.helpers import hhmm, paginate
from utils.validators import parse_jalali_input

router = Router(name="admin_appointments")
logger = logging.getLogger(__name__)

_FILTER_DEFAULT = ("all", "-")


# ---------------------------------------------------------------------------
# Filtering + listing
# ---------------------------------------------------------------------------
def _query(session, kind: str, arg: str) -> list[Appointment]:
    today = tehran_today()
    if kind == "today":
        return filter_appointments(session, day=today)
    if kind == "future":
        return filter_appointments(session, from_date=today)
    if kind == "staff":
        return filter_appointments(session, staff_id=int(arg))
    if kind == "status":
        return filter_appointments(session, status=arg)
    if kind == "date":
        return filter_appointments(session, day=date.fromisoformat(arg))
    return filter_appointments(session)


def _filter_title(kind: str, arg: str) -> str:
    titles = {
        "today": f"امروز ({to_jalali(tehran_today())})",
        "future": "آینده",
        "all": "همه نوبت‌ها",
        "staff": "کارشناس انتخاب‌شده",
        "status": STATUS_LABELS_FA.get(arg, arg),
        "date": to_jalali(date.fromisoformat(arg)) if arg != "-" else "تاریخ",
    }
    return titles.get(kind, kind)


async def _save_filter(state: FSMContext, kind: str, arg: str) -> None:
    await state.update_data(adm_appt_filter=[kind, arg])


async def _load_filter(state: FSMContext) -> tuple[str, str]:
    data = await state.get_data()
    value = data.get("adm_appt_filter")
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return str(value[0]), str(value[1])
    return _FILTER_DEFAULT


def _build_list(kind: str, arg: str, page: int) -> tuple[str, object]:
    with session_scope() as session:
        items = _query(session, kind, arg)
        result = paginate(items, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}📅 نوبت‌ها — {_filter_title(kind, arg)}",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for appt in result.items:
            owner = session.get(User, appt.user_id)
            lines.append(
                f"• {to_jalali(appt.date)} {hhmm(appt.start_time)} | {appt.tracking_code}\n"
                f"  {owner.full_name if owner else '—'} | {appt.service.name} | "
                f"{STATUS_LABELS_FA.get(appt.status, appt.status)}"
            )
            buttons.append([
                InlineKeyboardButton(
                    text=f"{hhmm(appt.start_time)} | {appt.tracking_code}",
                    callback_data=f"adm:appt:view:{appt.id}",
                )
            ])
        if not result.items:
            lines.append("موردی یافت نشد.")

    buttons.append(
        page_buttons(f"adm:appt:list:{kind}:{arg}", result.page, result.total_pages)
    )
    buttons.append([
        InlineKeyboardButton(text="🔍 فیلتر دیگر", callback_data="adm:appt:menu"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


async def _show_list(
    target: Message | CallbackQuery, state: FSMContext, kind: str, arg: str, page: int = 1
) -> None:
    await _save_filter(state, kind, arg)
    text, keyboard = _build_list(kind, arg, page)
    if isinstance(target, CallbackQuery):
        await safe_edit(target.message, text, keyboard)
        await target.answer()
    else:
        await target.answer(text, reply_markup=keyboard)


# ---------------------------------------------------------------------------
# Entry + filter menu
# ---------------------------------------------------------------------------
@router.message(F.text == BTN_ADMIN_APPOINTMENTS)
async def appointments_menu(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    await _save_filter(state, *_FILTER_DEFAULT)
    await message.answer(
        f"{DIVIDER}📅 مدیریت نوبت‌ها{DIVIDER}\n\nفیلتر موردنظر را انتخاب کنید:",
        reply_markup=from_rows([
            [
                InlineKeyboardButton(text="📅 نوبت‌های امروز", callback_data="adm:appt:list:today:-:1"),
                InlineKeyboardButton(text="⏭ نوبت‌های آینده", callback_data="adm:appt:list:future:-:1"),
            ],
            [InlineKeyboardButton(text="🗂 همه نوبت‌ها", callback_data="adm:appt:list:all:-:1")],
            [
                InlineKeyboardButton(text="🧑‍💼 بر اساس کارشناس", callback_data="adm:appt:pickstaff"),
                InlineKeyboardButton(text="📌 بر اساس وضعیت", callback_data="adm:appt:pickstatus"),
            ],
            [InlineKeyboardButton(text="🗓 بر اساس تاریخ", callback_data="adm:appt:askdate")],
        ]),
    )


@router.callback_query(F.data == "adm:appt:menu")
async def back_to_menu(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.clear()
    await safe_edit(
        callback.message,
        f"{DIVIDER}📅 مدیریت نوبت‌ها{DIVIDER}\n\nفیلتر موردنظر را انتخاب کنید:",
        from_rows([
            [
                InlineKeyboardButton(text="📅 نوبت‌های امروز", callback_data="adm:appt:list:today:-:1"),
                InlineKeyboardButton(text="⏭ نوبت‌های آینده", callback_data="adm:appt:list:future:-:1"),
            ],
            [InlineKeyboardButton(text="🗂 همه نوبت‌ها", callback_data="adm:appt:list:all:-:1")],
            [
                InlineKeyboardButton(text="🧑‍💼 بر اساس کارشناس", callback_data="adm:appt:pickstaff"),
                InlineKeyboardButton(text="📌 بر اساس وضعیت", callback_data="adm:appt:pickstatus"),
            ],
            [InlineKeyboardButton(text="🗓 بر اساس تاریخ", callback_data="adm:appt:askdate")],
        ]),
    )
    await callback.answer()


@router.callback_query(F.data == "adm:appt:pickstaff")
async def pick_staff(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    with session_scope() as session:
        staff_list = staff_service.list_staff(session)
    buttons = [
        [InlineKeyboardButton(text=f"🧑‍💼 {s.name}", callback_data=f"adm:appt:list:staff:{s.id}:1")]
        for s in staff_list
    ] or [[InlineKeyboardButton(text="— کارشناسی ثبت نشده —", callback_data="noop")]]
    buttons.append([InlineKeyboardButton(text="🔙 بازگشت", callback_data="adm:appt:menu")])
    await safe_edit(callback.message, "🧑‍💼 کارشناس موردنظر را انتخاب کنید:", from_rows(buttons))
    await callback.answer()


@router.callback_query(F.data == "adm:appt:pickstatus")
async def pick_status(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    rows = [
        [
            InlineKeyboardButton(
                text=STATUS_LABELS_FA[s],
                callback_data=f"adm:appt:list:status:{s}:1",
            )
        ]
        for s in APPOINTMENT_STATUSES
    ]
    rows.append([InlineKeyboardButton(text="🔙 بازگشت", callback_data="adm:appt:menu")])
    await safe_edit(callback.message, "📌 وضعیت نوبت را انتخاب کنید:", from_rows(rows))
    await callback.answer()


@router.callback_query(F.data == "adm:appt:askdate")
async def ask_date(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminDateFilter.date)
    await callback.message.answer(
        "🗓 تاریخ موردنظر را به شمسی وارد کنید (مثال: 1405/07/10):"
    )
    await callback.answer()


@router.message(AdminDateFilter.date, StateFilter(AdminDateFilter.date), F.text)
async def receive_date(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    day = parse_jalali_input(message.text or "")
    if day is None:
        await message.answer("❌ تاریخ نامعتبر است. نمونه: 1405/07/10")
        return
    await state.clear()
    await _show_list(message, state, "date", day.isoformat(), 1)


@router.callback_query(F.data.startswith("adm:appt:list:"))
async def show_filtered_list(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:appt:list:<kind>:<arg>:<page>
    if len(parts) != 6:
        await callback.answer()
        return
    kind, arg, page = parts[3], parts[4], safe_page(parts[5])
    await _show_list(callback, state, kind, arg, page)


def safe_page(value: str) -> int:
    try:
        return max(1, int(value))
    except ValueError:
        return 1


# ---------------------------------------------------------------------------
# Detail + status changes
# ---------------------------------------------------------------------------
def _build_detail(appt_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        if appt is None:
            return None
        owner = session.get(User, appt.user_id)
        text = (
            f"{DIVIDER}\n📋 جزئیات نوبت (مدیر)\n{DIVIDER}\n"
            f"👤 کاربر: {owner.full_name if owner else '—'}\n"
            f"📱 موبایل: {owner.phone if owner else '—'}\n"
            f"🛠 خدمت: {appt.service.name} ({appt.service.duration} دقیقه)\n"
            f"🧑‍💼 کارشناس: {appt.staff.name}\n"
            f"📅 تاریخ: {to_jalali(appt.date)} ({day_name(appt.date)})\n"
            f"⏰ ساعت: {hhmm(appt.start_time)} - {hhmm(appt.end_time)}\n"
            f"🔑 کد رهگیری: {appt.tracking_code}\n"
            f"📌 وضعیت: {STATUS_LABELS_FA.get(appt.status, appt.status)}\n"
            + (f"📝 یادداشت: {appt.note}\n" if appt.note else "")
            + f"🕓 ثبت: {appt.created_at:%Y-%m-%d %H:%M} UTC\n"
            f"{DIVIDER}"
        )
        buttons = []
        for status in APPOINTMENT_STATUSES:
            if status == appt.status:
                continue
            label = {
                "pending": "🕓 در انتظار تأیید",
                "confirmed": "✅ تأیید",
                "cancelled": "❌ لغو",
                "completed": "✔ انجام شد",
                "no_show": "🚫 عدم مراجعه",
            }[status]
            buttons.append([
                InlineKeyboardButton(
                    text=label, callback_data=f"adm:appt:ask:{appt.id}:{status}"
                )
            ])
        buttons.append([
            InlineKeyboardButton(text="🔙 بازگشت به لیست", callback_data="adm:appt:back")
        ])
    return text, from_rows(buttons)


@router.callback_query(F.data.startswith("adm:appt:view:"))
async def show_detail(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    appt_id = _int(callback.data.split(":")[3])
    built = _build_detail(appt_id) if appt_id else None
    if built is None:
        await callback.answer("❌ نوبت یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


@router.callback_query(F.data == "adm:appt:back")
async def back_to_list(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    kind, arg = await _load_filter(state)
    await _show_list(callback, state, kind, arg, 1)


@router.callback_query(F.data.startswith("adm:appt:ask:"))
async def ask_status_change(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:appt:ask:<id>:<status>
    appt_id, status = _int(parts[3]), parts[4]
    if appt_id is None or status not in APPOINTMENT_STATUSES:
        await callback.answer()
        return
    await safe_edit(
        callback.message,
        f"❓ وضعیت این نوبت به «{STATUS_LABELS_FA[status]}» تغییر کند؟",
        from_rows([[
            InlineKeyboardButton(text="✅ تأیید", callback_data=f"adm:appt:do:{appt_id}:{status}"),
            InlineKeyboardButton(text="❌ انصراف", callback_data=f"adm:appt:view:{appt_id}"),
        ]]),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:appt:do:"))
async def apply_status_change(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:appt:do:<id>:<status>
    appt_id, status = _int(parts[3]), parts[4]
    if appt_id is None or status not in APPOINTMENT_STATUSES:
        await callback.answer()
        return

    with session_scope() as session:
        appt = appointment_service.get(session, appt_id)
        if appt is None:
            await callback.answer("❌ نوبت یافت نشد.", show_alert=True)
            return
        appointment_service.set_status(session, appt, status)
        text = notification_service.appointment_status_text(session, appt, status)
        owner = session.get(User, appt.user_id)
        user_tg = owner.telegram_id if owner else None
        staff_id, day = appt.staff_id, appt.date

    logger.info("Admin changed appointment #%s -> %s", appt_id, status)
    if user_tg:
        ntype = {
            "confirmed": "appointment_confirmed",
            "cancelled": "appointment_cancelled",
            "pending": "appointment_confirmed",
            "completed": "appointment_confirmed",
            "no_show": "appointment_confirmed",
        }.get(status, "admin_message")
        await notification_service.send(user_tg, text, ntype=ntype)

    if status == "cancelled":
        # the slot is free again -> waiting users are informed
        await notification_service.notify_waitlist_entries(staff_id, day)

    built = _build_detail(appt_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])
    await callback.answer(f"✅ وضعیت به «{STATUS_LABELS_FA[status]}» تغییر کرد.")


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
