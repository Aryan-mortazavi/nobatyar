"""
🛠 مدیریت خدمات (admin) - complete CRUD.

    list -> create (4-step form) -> view -> edit any field
         -> enable / disable -> delete (with confirmation)
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message

from database.session import session_scope
from handlers.admin.base import ensure_admin, home_button, page_buttons, safe_edit
from handlers.states import AdminServiceForm
from keyboards.inline_keyboard import from_rows
from services import service_service
from services.service_service import ServiceError
from utils.calendar import to_jalali
from utils.constants import BTN_ADMIN_SERVICES, DIVIDER, PAGE_SIZE_TELEGRAM
from utils.helpers import paginate, price_text
from utils.validators import parse_positive_int

router = Router(name="admin_services")
logger = logging.getLogger(__name__)

_FIELD_LABELS = {
    "name": "نام",
    "description": "توضیحات",
    "duration": "مدت (دقیقه)",
    "price": "قیمت (اطلاع‌رسانی)",
}


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------
def _build_list(page: int) -> tuple[str, object]:
    with session_scope() as session:
        services = service_service.list_services(session)
        result = paginate(services, page, PAGE_SIZE_TELEGRAM)
        lines = [
            f"{DIVIDER}🛠 خدمات",
            f"({result.start_index}-{result.end_index} از {result.total}){DIVIDER}",
        ]
        buttons: list[list[InlineKeyboardButton]] = []
        for svc in result.items:
            flag = "✅" if svc.is_active else "⛔"
            lines.append(
                f"• {flag} {svc.name} | {svc.duration} دقیقه | {price_text(svc.price)}"
            )
            buttons.append([
                InlineKeyboardButton(text=f"{flag} {svc.name}", callback_data=f"adm:svc:view:{svc.id}")
            ])
        if not result.items:
            lines.append("خدمتی ثبت نشده است.")

    buttons.append(page_buttons("adm:svc:list", result.page, result.total_pages))
    buttons.append([
        InlineKeyboardButton(text="➕ افزودن خدمت", callback_data="adm:svc:add"),
        home_button(),
    ])
    return "\n".join(lines), from_rows(buttons)


@router.message(F.text == BTN_ADMIN_SERVICES)
async def services_menu(message: Message) -> None:
    if not await ensure_admin(message):
        return
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("adm:svc:list"))
async def show_services(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    page = _page(callback.data.rsplit(":", 1)[-1])
    text, keyboard = _build_list(page)
    await safe_edit(callback.message, text, keyboard)
    await callback.answer()


# ---------------------------------------------------------------------------
# Create (FSM: name -> description -> duration -> price)
# ---------------------------------------------------------------------------
@router.callback_query(F.data == "adm:svc:add")
async def ask_new_service(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    await state.set_state(AdminServiceForm.name)
    await state.update_data(svc_edit_id=None)
    await callback.message.answer(
        "➕ نام خدمت جدید را وارد کنید (مثال: ویزیت، مشاوره):",
        reply_markup=_back_keyboard(),
    )
    await callback.answer()


@router.message(AdminServiceForm.name, StateFilter(AdminServiceForm.name), F.text)
async def receive_service_name(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    name = (message.text or "").strip()
    if not name:
        await message.answer("❌ نام نمی‌تواند خالی باشد:")
        return
    await state.update_data(svc_name=name)
    await state.set_state(AdminServiceForm.description)
    await message.answer(
        "📝 توضیحات خدمت را وارد کنید (برای رد شدن بنویسید: -):",
        reply_markup=_back_keyboard(),
    )


@router.message(AdminServiceForm.description, StateFilter(AdminServiceForm.description), F.text)
async def receive_service_description(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    text = (message.text or "").strip()
    await state.update_data(svc_description="" if text == "-" else text)
    await state.set_state(AdminServiceForm.duration)
    await message.answer(
        "⏱ مدت زمان خدمت را به دقیقه وارد کنید (مثال: 30):",
        reply_markup=_back_keyboard(),
    )


@router.message(AdminServiceForm.duration, StateFilter(AdminServiceForm.duration), F.text)
async def receive_service_duration(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    value = parse_positive_int(message.text or "")
    if value is None or value <= 0:
        await message.answer("❌ یک عدد صحیح بزرگ‌تر از صفر وارد کنید (مثال: 30):")
        return
    await state.update_data(svc_duration=value)
    await state.set_state(AdminServiceForm.price)
    await message.answer(
        "💰 قیمت خدمت را به تومان وارد کنید (فقط برای نمایش؛ پرداختی وجود ندارد).\n"
        "برای رایگان بنویسید: 0",
        reply_markup=_back_keyboard(),
    )


@router.message(AdminServiceForm.price, StateFilter(AdminServiceForm.price), F.text)
async def receive_service_price(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    price = parse_positive_int(message.text or "")
    if price is None:
        await message.answer("❌ یک عدد صحیح غیرمنفی وارد کنید (مثال: 150000):")
        return

    data = await state.get_data()
    with session_scope() as session:
        try:
            service = service_service.create(
                session,
                name=data.get("svc_name", ""),
                description=data.get("svc_description", ""),
                duration=int(data.get("svc_duration", 30)),
                price=price,
            )
            service_id = service.id
        except ServiceError as exc:
            await state.clear()
            await message.answer(str(exc))
            return

    await state.clear()
    logger.info("Admin created service #%s (%s)", service_id, data.get("svc_name"))
    await message.answer(f"✅ خدمت «{data.get('svc_name')}» ایجاد شد.")
    text, keyboard = _build_list(1)
    await message.answer(text, reply_markup=keyboard)


# ---------------------------------------------------------------------------
# View / edit / toggle / delete
# ---------------------------------------------------------------------------
def _build_detail(service_id: int) -> tuple[str, object] | None:
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            return None
        staff_names = ", ".join(s.name for s in service.staff) or "—"
        text = (
            f"{DIVIDER}\n🛠 جزئیات خدمت\n{DIVIDER}\n"
            f"🆔 شناسه: {service.id}\n"
            f"📛 نام: {service.name}\n"
            f"📝 توضیحات: {service.description or '—'}\n"
            f"⏱ مدت: {service.duration} دقیقه\n"
            f"💰 قیمت (اطلاع‌رسانی): {price_text(service.price)}\n"
            f"وضعیت: {'✅ فعال' if service.is_active else '⛔ غیرفعال'}\n"
            f"🧑‍💼 کارشناسان: {staff_names}\n"
            f"🗓 ایجاد: {to_jalali(service.created_at.date()) if service.created_at else '—'}\n"
            f"{DIVIDER}"
        )
        buttons: list[list[InlineKeyboardButton]] = [
            [InlineKeyboardButton(text="✏️ ویرایش اطلاعات", callback_data=f"adm:svc:edit:{service.id}")],
            [InlineKeyboardButton(
                text=("⛔ غیرفعال کردن" if service.is_active else "✅ فعال کردن"),
                callback_data=f"adm:svc:toggle:{service.id}",
            )],
            [InlineKeyboardButton(text="🗑 حذف خدمت", callback_data=f"adm:svc:del:{service.id}")],
            [InlineKeyboardButton(text="🔙 بازگشت به لیست", callback_data="adm:svc:list:1")],
        ]
    return text, from_rows(buttons)


@router.callback_query(F.data.startswith("adm:svc:view:"))
async def show_service(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    built = _build_detail(_int(callback.data.split(":")[3]) or 0)
    if built is None:
        await callback.answer("❌ خدمت یافت نشد.", show_alert=True)
        return
    await safe_edit(callback.message, built[0], built[1])
    await callback.answer()


@router.callback_query(F.data.startswith("adm:svc:edit:"))
async def ask_field(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    service_id = _int(callback.data.split(":")[3])
    if service_id is None:
        await callback.answer()
        return
    rows = [
        [InlineKeyboardButton(
            text=f"✏️ {label}", callback_data=f"adm:svc:field:{service_id}:{key}"
        )]
        for key, label in _FIELD_LABELS.items()
    ]
    rows.append([
        InlineKeyboardButton(text="🔙 بازگشت", callback_data=f"adm:svc:view:{service_id}")
    ])
    await safe_edit(callback.message, "کدام فیلد را می‌خواهید تغییر دهید؟", from_rows(rows))
    await callback.answer()


@router.callback_query(F.data.startswith("adm:svc:field:"))
async def ask_field_value(callback: CallbackQuery, state: FSMContext) -> None:
    if not await ensure_admin(callback):
        return
    parts = callback.data.split(":")  # adm:svc:field:<id>:<field>
    service_id, field = _int(parts[3]), parts[4]
    if service_id is None or field not in _FIELD_LABELS:
        await callback.answer()
        return
    await state.set_state(AdminServiceForm.field)
    await state.update_data(svc_edit_id=service_id, svc_field=field)
    hints = {
        "name": "نام جدید خدمت:",
        "description": "توضیحات جدید (برای خالی کردن: -):",
        "duration": "مدت جدید به دقیقه:",
        "price": "قیمت جدید (تومان):",
    }
    await callback.message.answer(hints[field], reply_markup=_back_keyboard())
    await callback.answer()


@router.message(AdminServiceForm.field, StateFilter(AdminServiceForm.field), F.text)
async def save_field(message: Message, state: FSMContext) -> None:
    if not await ensure_admin(message):
        return
    data = await state.get_data()
    service_id, field = data.get("svc_edit_id"), data.get("svc_field")
    raw = (message.text or "").strip()

    fields: dict = {}
    if field == "name":
        fields["name"] = raw
    elif field == "description":
        fields["description"] = "" if raw == "-" else raw
    elif field in ("duration", "price"):
        value = parse_positive_int(raw)
        if value is None or (field == "duration" and value <= 0):
            await message.answer("❌ یک عدد صحیح غیرمنفی وارد کنید:")
            return
        fields[field] = value

    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            await state.clear()
            await message.answer("❌ خدمت یافت نشد.")
            return
        try:
            service_service.update(session, service, **fields)
        except ServiceError as exc:
            await message.answer(str(exc))
            return

    logger.info("Admin updated service #%s field=%s", service_id, field)
    await state.clear()
    await message.answer("✅ اطلاعات خدمت به‌روزرسانی شد.")
    built = _build_detail(service_id)
    if built:
        await message.answer(built[0], reply_markup=built[1])


@router.callback_query(F.data.startswith("adm:svc:toggle:"))
async def toggle_service(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    service_id = _int(callback.data.split(":")[3])
    if service_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            await callback.answer("❌ خدمت یافت نشد.", show_alert=True)
            return
        service_service.set_active(session, service, not service.is_active)
        state_text = "✅ فعال" if service.is_active else "⛔ غیرفعال"
    logger.info("Admin toggled service #%s -> %s", service_id, state_text)
    built = _build_detail(service_id)
    if built:
        await safe_edit(callback.message, built[0], built[1])
    await callback.answer(f"وضعیت خدمت: {state_text}")


@router.callback_query(F.data.startswith("adm:svc:del:"))
async def ask_delete(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    service_id = _int(callback.data.split(":")[3])
    if service_id is None:
        await callback.answer()
        return
    await safe_edit(
        callback.message,
        "❓ آیا از حذف این خدمت مطمئن هستید؟\n(اگر برای آن نوبت ثبت شده باشد حذف ممکن نیست)",
        from_rows([[
            InlineKeyboardButton(text="✅ بله، حذف شود", callback_data=f"adm:svc:dodel:{service_id}"),
            InlineKeyboardButton(text="❌ خیر", callback_data=f"adm:svc:view:{service_id}"),
        ]]),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:svc:dodel:"))
async def delete_service(callback: CallbackQuery) -> None:
    if not await ensure_admin(callback):
        return
    service_id = _int(callback.data.split(":")[3])
    if service_id is None:
        await callback.answer()
        return
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            await callback.answer("❌ خدمت یافت نشد.", show_alert=True)
            return
        name = service.name
        try:
            service_service.delete(session, service)
        except ServiceError as exc:
            await callback.answer(str(exc), show_alert=True)
            return
    logger.info("Admin deleted service #%s (%s)", service_id, name)
    text, keyboard = _build_list(1)
    await safe_edit(callback.message, f"✅ خدمت «{name}» حذف شد.\n\n{text}", keyboard)
    await callback.answer("حذف شد.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _back_keyboard():
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
