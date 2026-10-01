"""
Telegram presentation layer.

Two rules:

1. **Wording comes from the web app.** Every menu button and message body is a
   label the API returns (``channel.*`` in the web app's dictionary), so the tone
   of the product is defined in exactly one place. The strings in this module
   are only the *chrome* Telegram needs: the service line inside a card, the
   time grid, the "«»" quotes.

2. **A dead web app must never look like a broken bot.** Every helper degrades
   to a sensible Persian default when a label is missing, and the handlers show
   a single "try again later" message instead of a stack trace.
"""

from __future__ import annotations

from datetime import datetime

from channel.api import Appointment, Catalogue, CustomerPackage, Service, Slot

DIVIDER = "───────────────"
ARROW = "‹"  # points left, correct for RTL text


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
def money(amount: int | None, currency: str = "IRT") -> str:
    """1_200_000 → «۱٬۲۰۰٬۰۰۰ تومان»."""
    if not amount:
        return ""
    digits = "۰۱۲۳۴۵۶۷۸۹"
    grouped = f"{amount:,}"
    persian = "".join(digits[int(char)] if char.isdigit() else char for char in grouped)
    unit = "تومان" if currency.upper() in {"IRT", "TOMAN"} else currency.upper()
    return f"{persian} {unit}"


def duration(minutes: int) -> str:
    """90 → «۹۰ دقیقه»."""
    digits = "۰۱۲۳۴۵۶۷۸۹"
    return "".join(digits[int(char)] if char.isdigit() else char for char in str(minutes))


def service_line(service: Service, currency: str = "IRT") -> str:
    """One line describing a service, e.g. «پاکسازی عمیق پوست · ۶۰ دقیقه»."""
    parts = [service.title]
    if service.duration_min:
        parts.append(f"{duration(service.duration_min)} دقیقه")
    price = money(service.price, currency)
    if price:
        parts.append(price)
    return " · ".join(parts)


def appointment_line(appointment: Appointment) -> str:
    """A single appointment as one line of text."""
    marker = "🔁" if appointment.series_index else "📌"
    where = f" · {appointment.location_title}" if appointment.location_title else ""
    bundle = " 🎁" if appointment.used_package_session else ""
    return (
        f"{marker} {appointment.when_text} — {appointment.service_title}"
        f" · {appointment.staff_name}{where}{bundle}\n"
        f"    {appointment.status_label} · {appointment.tracking_code}"
    )


def appointment_card(appointment: Appointment) -> str:
    """A fuller card used on the "my appointments" screen."""
    lines = [f"🗓 {appointment.service_title}", f"👤 {appointment.staff_name}"]
    lines.append(f"📅 {appointment.when_text}")
    if appointment.location_title:
        lines.append(f"📍 {appointment.location_title}")
    lines.append(f"🔖 کد رهگیری: {appointment.tracking_code}")
    if appointment.series_index:
        lines.append(f"🔁 جلسهٔ {duration(appointment.series_index)} از سری هفتگی")
    if appointment.used_package_session:
        lines.append("🎁 از بستهٔ شما")
    lines.append(f"⚪️ وضعیت: {appointment.status_label}")
    return "\n".join(lines)


def package_card(package: CustomerPackage) -> str:
    lines = [f"🎁 {package.name}"]
    lines.append(
        f"   جلسات باقیمانده: {duration(package.remaining_sessions)}"
        f" از {duration(package.total_sessions)}"
    )
    if package.lines:
        for line in package.lines:
            lines.append(
                f"   • {line.title}: {duration(line.remaining)}"
                f" از {duration(line.quantity)}"
            )
    return "\n".join(lines)


def slot_grid(slots: list[Slot], per_row: int = 3) -> str:
    """Times as a monospaced-ish grid, free ones only."""
    if not slots:
        return ""
    rows = []
    for start in range(0, len(slots), per_row):
        rows.append("   ".join(slot.label for slot in slots[start : start + per_row]))
    return "\n".join(rows)


def workspace_header(catalogue: Catalogue) -> str:
    """First screen after /start."""
    workspace = catalogue.workspace
    parts = [f"🏥 {workspace.title}"]
    if workspace.phone:
        parts.append(f"📞 {workspace.phone}")
    if workspace.address:
        parts.append(f"📍 {workspace.address}")
    return "\n".join(parts)


def menu_text(catalogue: Catalogue, greeting: str = "") -> str:
    """The main menu body."""
    lines = [greeting] if greeting else []
    lines.append("")
    lines.append(f"🏥 <b>{catalogue.workspace.title}</b>")
    lines.append("")
    lines.append("یکی از گزینه‌های زیر را انتخاب کنید:")
    return "\n".join(lines)


def error_text(catalogue: Catalogue | None, fallback: str = "") -> str:
    label = catalogue.label("error", "") if catalogue else ""
    return label or fallback or "خطایی رخ داد. لطفاً دوباره تلاش کنید."


def unavailable_text(catalogue: Catalogue | None) -> str:
    label = catalogue.label("unavailable", "") if catalogue else ""
    return label or "⏳ این گزینه در حال حاضر در دسترس نیست."


def format_datetime_label(value: str) -> str:
    """ISO → '1405/07/10 09:30' (used for logs and small captions)."""
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return value
    return parsed.strftime("%Y-%m-%d %H:%M")


__all__ = [
    "ARROW",
    "DIVIDER",
    "appointment_card",
    "appointment_line",
    "duration",
    "error_text",
    "format_datetime_label",
    "menu_text",
    "money",
    "package_card",
    "service_line",
    "slot_grid",
    "unavailable_text",
    "workspace_header",
]
