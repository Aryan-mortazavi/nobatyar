"""
🧑‍💼 مدیریت کارکنان (admin) - complete CRUD + service assignment.

    list -> create (3-step form) -> view
         -> edit name / specialty / phone
         -> enable / disable
         -> assign the services this person actually provides
         -> open the weekly schedule (handled by the hours module)
         -> delete (blocked while appointments exist)
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminStaffForm
from keyboards.inline_keyboard import from_rows
from services import service_service, staff_service
from services.staff_service import StaffError
from utils.calendar import to_jalali
from utils.constants import BTN_ADMIN_STAFF, DIVIDER, PAGE_SIZE_TELEGRAM
from utils.helpers import paginate
from utils.validators import validate_name, validate_phone

router = Router(name="admin_staff")
logger = logging.getLogger(__name__)

_FIELD_LABELS = {"name": "نام", "specialty": "تخصص", "phone": "شماره تماس"}


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------
def _build_list(page: int) -> tuple[str, object]:
    with session_scope() as session:
        staff_list = staff_service.list_staff(session)
        result = paginate(staff_list, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}🧑‍💼 کارکنان",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for member in result.items:
            flag = "✅" if member.is_active else "⛔"
            lines.append(f"• {flag} {member.name} | {member.specialty or 'بدون تخصص'}")
            buttons.append([
                InlineKeyboardButton(
                    text=f"{flag} {member.name}", callback_data=f"adm:staff:view:{member.id}"
                )
            ])
        if not result.items:
            lines.append("کارشناسی ثبت نشده است.")

    buttons.append(page_buttons("adm:staff:list", result.page, result.total_pages))
    buttons.append([
        InlineKeyboardButton(text="➕ افزودن کارشناس", callback_data="adm:staff:add"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_STAFF)
async def staff_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:staff:list"))
async def show_staff_list(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    page = _page(callback.data.rsplit(":", 1)[-1])
    text, keyboard = _build_list(page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


# ---------------------------------------------------------------------------
# Create (FSM: name -> specialty -> phone)
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "adm:staff:add")
async def ask_new_staff(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminStaffForm.name)
    await callback.message.answer(
        "➕ نام کارشناس جدید را وارد کنید:", reply_markup=_back()
    )
    await callback.answer()


@router.message(AdminStaffForm.name, StateFilter(AdminStaffForm.name), F.text)
async def receive_staff_name(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    name, error = validate_name(message.text or "")
    if error:
        await message.answer(error)
        return
    await state.update_data(staff_name=name)
    await state.set_state(AdminStaffForm.specialty)
    await message.answer(
        "🎓 تخصص کارشناس را وارد کنید (برای رد شدن: -):", reply_markup=_back()
    )


@router.message(AdminStaffForm.specialty, StateFilter(AdminStaffForm.specialty), F.text)
async def receive_staff_specialty(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    text = (message.text or "").strip()
    await state.update_data(staff_specialty="" if text == "-" else text)
    await state.set_state(AdminStaffForm.phone)
    await message.answer(
        "📱 شماره تماس کارشناس را وارد کنید (مثال: 09123456789 یا برای رد شدن: -):",
        reply_markup=_back(),
    )


@router.message(AdminStaffForm.phone, StateFilter(AdminStaffForm.phone), F.text)
async def receive_staff_phone(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    raw = (message.text or "").strip()
    phone = ""
    if raw != "-":
        phone, error = validate_phone(raw)
        if error:
            await message.answer(error)
            return

    data = await state.get_data()
    with session_scope() as session:
        try:
            member = staff_service.create(
                session,
                name=data.get("staff_name", ""),
                specialty=data.get("staff_specialty", ""),
                phone=phone,
            )
            staff_id = member.id
        except StaffError as exc:
            await state.clear()
            await message.answer(str(exc))
            return

    logger.info("Admin created staff #%s (%s)", staff_id, data.get("staff_name"))
    await state.clear()
    await message.answer(
        f"✅ کارشناس «{data.get('staff_name')}» ایجاد شد.\n"
        "یک برنامه هفتگی پیش‌فرض (شنبه تا پنجشنبه) برای او ثبت شد."
    )
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


# ---------------------------------------------------------------------------
# View / edit / toggle / assign services / schedule / delete
# ---------------------------------------------------------------------------
def _build_detail(staff_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            return None
        services = ", ".join(s.name for s in member.services) or "—"
        schedule = staff_service.schedule_text(session, member)
        text = (
            f"{DIVIDER}\n🧑‍💼 جزئیات کارشناس\n{DIVIDER}\n"
            f"🆔 شناسه: {member.id}\n"
            f"📛 نام: {member.name}\n"
            f"🎓 تخصص: {member.specialty or '—'}\n"
            f"📱 تماس: {member.phone or '—'}\n"
            f"وضعیت: {'✅ فعال' if member.is_active else '⛔ غیرفعال'}\n"
            f"🛠 خدمات: {services}\n"
            f"🗓 ایجاد: {to_jalali(member.created_at.date()) if member.created_at else '—'}\n\n"
            f"🕐 برنامه هفتگی:\n{schedule}\n"
            f"{DIVIDER}"
        )
        buttons = [
            [InlineKeyboardButton(text="✏️ ویرایش اطلاعات", callback_data=f"adm:staff:edit:{staff_id}")],
            [InlineKeyboardButton(
                text=("⛔ غیرفعال کردن" if member.is_active else "✅ فعال کردن"),
                callback_data=f"adm:staff:toggle:{staff_id}",
            )],
            [InlineKeyboardButton(text="🛠 انتخاب خدمات", callback_data=f"adm:staff:services:{staff_id}")],
            [InlineKeyboardButton(text="🕐 ساعات کاری", callback_data=f"adm:hour:staff:{staff_id}")],
            [InlineKeyboardButton(text="🗑 حذف کارشناس", callback_data=f"adm:staff:del:{staff_id}")],
            [InlineKeyboardButton(text="🔙 بازگشت به لیست", callback_data="adm:staff:list:1")],
        ]
    return text, from_rows(buttons)


@router.callback_query(F.data.startswith("adm:staff:view:"))
async def show_staff(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    built = _build_detail(_int(callback.data.split(":")[3]) or 0)
    if built is None:
        await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


@router.callback_query(F.data.startswith("adm:staff:edit:"))
async def ask_staff_field(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    if staff_id is None:
        await callback.answer()
        return
    rows = [
        [InlineKeyboardButton(
            text=f"✏️ {label}", callback_data=f"adm:staff:field:{staff_id}:{key}"
        )]
        for key, label in _FIELD_LABELS.items()
    ]
    rows.append([InlineKeyboardButton(text="🔙 بازگشت", callback_data=f"adm:staff:view:{staff_id}")])
    await safe_edit(callback.message, "کدام فیلد را می‌خواهید تغییر دهید؟", from_rows(rows))
    await callback.answer()


@router.callback_query(F.data.startswith("adm:staff:field:"))
async def ask_staff_value(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:staff:field:<id>:<field>
    staff_id, field = _int(parts[3]), parts[4]
    if staff_id is None or field not in _FIELD_LABELS:
        await callback.answer()
        return
    await state.set_state(AdminStaffForm.field)
    await state.update_data(staff_edit_id=staff_id, staff_field=field)
    hints = {
        "name": "نام جدید کارشناس:",
        "specialty": "تخصص جدید (برای خالی کردن: -):",
        "phone": "شماره تماس جدید:",
    }
    await callback.message.answer(hints[field], reply_markup=_back())
    await callback.answer()


@router.message(AdminStaffForm.field, StateFilter(AdminStaffForm.field), F.text)
async def save_staff_field(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    data = await state.get_data()
    staff_id, field = data.get("staff_edit_id"), data.get("staff_field")
    raw = (message.text or "").strip()

    fields: dict = {}
    if field == "name":
        name, error = validate_name(raw)
        if error:
            await message.answer(error)
            return
        fields["name"] = name
    elif field == "specialty":
        fields["specialty"] = "" if raw == "-" else raw
    elif field == "phone":
        if raw == "-":
            fields["phone"] = ""
        else:
            phone, error = validate_phone(raw)
            if error:
                await message.answer(error)
                return
            fields["phone"] = phone

    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            await state.clear()
            await message.answer("❌ کارشناس یافت نشد.")
            return
        try:
            staff_service.update(session, member, **fields)
        except StaffError as exc:
            await message.answer(str(exc))
            return

    logger.info("Admin updated staff #%s field=%s", staff_id, field)
    await state.clear()
    await message.answer("✅ اطلاعات کارشناس به‌روزرسانی شد.")
    built = _build_detail(staff_id)
    if built:
        await message.answer(built[0], reply_markup=built[1])


@router.callback_query(F.data.startswith("adm:staff:toggle:"))
async def toggle_staff(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    if staff_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
            return
        staff_service.set_active(session, member, not member.is_active)
        state_text = "✅ فعال" if member.is_active else "⛔ غیرفعال"
    logger.info("Admin toggled staff #%s -> %s", staff_id, state_text)
    built = _build_detail(staff_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])
    await callback.answer(f"وضعیت کارشناس: {state_text}")


# ---------------------------------------------------------------------------
# Service assignment (many-to-many)
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("adm:staff:services:"))
async def show_assignments(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    if staff_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
            return
        all_services = service_service.list_services(session)
        assigned = {s.id for s in member.services}
        name = member.name

    rows = [
        [InlineKeyboardButton(
            text=(f"✅ " if svc.id in assigned else "⬜ ") + svc.name,
            callback_data=f"adm:staff:tsvc:{staff_id}:{svc.id}",
        )]
        for svc in all_services
    ] or [[InlineKeyboardButton(text="— خدمتی ثبت نشده —", callback_data="noop")]]
    rows.append([
        InlineKeyboardButton(text="🔙 بازگشت", callback_data=f"adm:staff:view:{staff_id}")
    ])
    await safe_edit(
        callback.message,
        f"🛠 خدمات «{name}» (روی هر مورد بزنید تا فعال/غیرفعال شود):",
        from_rows(rows),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:staff:tsvc:"))
async def toggle_assignment(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:staff:tsvc:<staff>:<service>
    staff_id, service_id = _int(parts[3]), _int(parts[4])
    if staff_id is None or service_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
            return
        try:
            assigned = staff_service.toggle_service(session, member, service_id)
        except StaffError as exc:
            await callback.answer(str(exc), show_alert=True)
            return
    await callback.answer("✅ افزوده شد." if assigned else "❎ حذف شد.")
    await show_assignments(callback)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------
@router.callback_query(F.data.startswith("adm:staff:del:"))
async def ask_delete_staff(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    if staff_id is None:
        await callback.answer()
        return
    await safe_edit(
        callback.message,
        "❓ آیا از حذف این کارشناس مطمئن هستید؟\n"
        "(اگر برای او نوبت ثبت شده باشد حذف ممکن نیست)",
        from_rows([[
            InlineKeyboardButton(text="✅ بله، حذف شود", callback_data=f"adm:staff:dodel:{staff_id}"),
            InlineKeyboardButton(text="❌ خیر", callback_data=f"adm:staff:view:{staff_id}"),
        ]]),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:staff:dodel:"))
async def delete_staff(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    staff_id = _int(callback.data.split(":")[3])
    if staff_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            await callback.answer("❌ کارشناس یافت نشد.", show_alert=True)
            return
        name = member.name
        try:
            staff_service.delete(session, member)
        except StaffError as exc:
            await callback.answer(str(exc), show_alert=True)
            return
    logger.info("Admin deleted staff #%s (%s)", staff_id, name)
    text, keyboard = _build_list(1)
    await safe_edit(callback.message, f"✅ کارشناس «{name}» حذف شد.\n\n{text}", keyboard)
    await callback.answer("حذف شد.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _back():
    from keyboards.user_keyboard import back_cancel_keyboard

    return back_cancel_keyboard()


def _page(value: str) -> int:
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def _int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
