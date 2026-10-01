"""
Shared constants: roles, statuses, button labels, settings keys.

Keeping every user-facing string in one place makes the Telegram UI
consistent and easy to translate / change.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# User roles (the design allows adding more roles later, e.g. "staff")
# ---------------------------------------------------------------------------
ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLE_MODERATOR = "moderator"  # reserved for a future role

# ---------------------------------------------------------------------------
# Appointment statuses (+ Persian labels used everywhere in the UI)
# ---------------------------------------------------------------------------
STATUS_PENDING = "pending"
STATUS_CONFIRMED = "confirmed"
STATUS_CANCELLED = "cancelled"
STATUS_COMPLETED = "completed"
STATUS_NO_SHOW = "no_show"

APPOINTMENT_STATUSES = (
    STATUS_PENDING,
    STATUS_CONFIRMED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_NO_SHOW,
)

STATUS_LABELS_FA: dict[str, str] = {
    STATUS_PENDING: "در انتظار تأیید",
    STATUS_CONFIRMED: "تأیید شده",
    STATUS_CANCELLED: "لغو شده",
    STATUS_COMPLETED: "انجام شده",
    STATUS_NO_SHOW: "عدم مراجعه",
}

# Statuses that still occupy a time slot
ACTIVE_STATUSES = (STATUS_PENDING, STATUS_CONFIRMED)

# ---------------------------------------------------------------------------
# Waitlist / support ticket statuses
# ---------------------------------------------------------------------------
WAITLIST_STATUSES = ("pending", "notified", "booked", "cancelled", "expired")
WAITLIST_LABELS_FA: dict[str, str] = {
    "pending": "در انتظار",
    "notified": "اطلاع‌رسانی شد",
    "booked": "رزرو شد",
    "cancelled": "لغو شد",
    "expired": "منقضی شد",
}

TICKET_STATUSES = ("open", "answered", "closed")
TICKET_LABELS_FA: dict[str, str] = {
    "open": "باز",
    "answered": "پاسخ داده شد",
    "closed": "بسته شد",
}

# ---------------------------------------------------------------------------
# Persian week (Saturday = 0) and month names
# ---------------------------------------------------------------------------
PERSIAN_DAYS = [
    "شنبه",      # 0
    "یکشنبه",    # 1
    "دوشنبه",    # 2
    "سه‌شنبه",   # 3
    "چهارشنبه",  # 4
    "پنجشنبه",   # 5
    "جمعه",      # 6
]

PERSIAN_DAYS_SHORT = ["شنب", "یک", "دو", "سه", "چهار", "پنج", "جمعه"]

PERSIAN_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]

# ---------------------------------------------------------------------------
# Main menu buttons (shared by keyboards + handlers so they always match)
# ---------------------------------------------------------------------------
MENU_TITLE = "🏠 منوی اصلی"

BTN_BOOK = "📝 رزرو نوبت"
BTN_MY_APPOINTMENTS = "📅 نوبت‌های من"
BTN_RESCHEDULE = "🔄 تغییر وقت نوبت"
BTN_CANCEL_APPOINTMENT = "❌ لغو نوبت"
BTN_PROFILE = "👤 پروفایل من"
BTN_SUPPORT = "📞 تماس با پشتیبانی"
BTN_ABOUT = "ℹ️ درباره ما"
BTN_BACK = "🔙 بازگشت"
BTN_BACK_TO_MENU = "🔙 بازگشت به منو"
BTN_CANCEL = "❌ انصراف"
BTN_CONFIRM = "✅ تأیید"
BTN_YES = "بله"
BTN_NO = "خیر"
BTN_CLOSE = "بستن"

MAIN_MENU_BUTTONS: tuple[str, ...] = (
    BTN_BOOK,
    BTN_MY_APPOINTMENTS,
    BTN_RESCHEDULE,
    BTN_CANCEL_APPOINTMENT,
    BTN_PROFILE,
    BTN_SUPPORT,
    BTN_ABOUT,
)

# Booking flow labels
BTN_NEXT_MONTH = "⬅️ ماه بعد"
BTN_PREV_MONTH = "ماه قبل ➡️"

# ---------------------------------------------------------------------------
# My appointments tabs
# ---------------------------------------------------------------------------
TAB_UPCOMING = "upcoming"
TAB_PAST = "past"
TAB_CANCELLED = "cancelled"

TAB_LABELS_FA = {
    TAB_UPCOMING: "آینده",
    TAB_PAST: "گذشته",
    TAB_CANCELLED: "لغو شده",
}

# ---------------------------------------------------------------------------
# Admin panel
# ---------------------------------------------------------------------------
ADMIN_MENU_TITLE = "⚙️ پنل مدیریت"

BTN_DASHBOARD = "📊 داشبورد"
BTN_ADMIN_APPOINTMENTS = "📅 مدیریت نوبت‌ها"
BTN_ADMIN_USERS = "👥 مدیریت کاربران"
BTN_ADMIN_STAFF = "🧑‍💼 مدیریت کارکنان"
BTN_ADMIN_SERVICES = "🛠 مدیریت خدمات"
BTN_ADMIN_HOURS = "🕐 ساعات کاری"
BTN_ADMIN_HOLIDAYS = "🚫 تعطیلات"
BTN_ADMIN_WAITLIST = "⏳ لیست انتظار"
BTN_ADMIN_REPORTS = "📈 گزارش‌ها"
BTN_ADMIN_TICKETS = "📨 تیکت‌های پشتیبانی"
BTN_ADMIN_SETTINGS = "⚙️ تنظیمات"
BTN_ADMIN_EXIT = "🏠 خروج از پنل مدیریت"

ADMIN_MENU_BUTTONS: tuple[str, ...] = (
    BTN_DASHBOARD,
    BTN_ADMIN_APPOINTMENTS,
    BTN_ADMIN_USERS,
    BTN_ADMIN_STAFF,
    BTN_ADMIN_SERVICES,
    BTN_ADMIN_HOURS,
    BTN_ADMIN_HOLIDAYS,
    BTN_ADMIN_WAITLIST,
    BTN_ADMIN_REPORTS,
    BTN_ADMIN_TICKETS,
    BTN_ADMIN_SETTINGS,
    BTN_ADMIN_EXIT,
)

NO_PERMISSION_MESSAGE = "❌ شما مجوز دسترسی به پنل مدیریت را ندارید."

# ---------------------------------------------------------------------------
# Global settings (stored in the "settings" table)
# ---------------------------------------------------------------------------
SETTING_CENTER_NAME = "center_name"
SETTING_PHONE = "phone"
SETTING_ADDRESS = "address"
SETTING_ABOUT = "about_text"
SETTING_SUPPORT_MESSAGE = "support_message"
SETTING_CANCELLATION_HOURS = "cancellation_limit_hours"
SETTING_SLOT_DURATION = "default_slot_duration"
SETTING_MAX_DAYS_AHEAD = "max_days_ahead"
SETTING_TIMEZONE = "timezone"
SETTING_AUTO_CONFIRM = "auto_confirm"

SETTINGS_DEFAULTS: dict[str, tuple[str, str]] = {
    # key: (default value, description)
    SETTING_CENTER_NAME: ("مرکز نوبت‌دهی", "نام مرکز (نمایش در «درباره ما»)"),
    SETTING_PHONE: ("021-00000000", "تلفن تماس مرکز"),
    SETTING_ADDRESS: ("تهران، خیابان نمونه، پلاک ۱", "آدرس مرکز"),
    SETTING_AUTO_CONFIRM: (
        "yes",
        "تأیید خودکار نوبت‌های جدید (yes = تأیید خودکار، no = نیازمند تأیید مدیر)",
    ),
    SETTING_ABOUT: (
        "مرکز نوبت‌دهی آنلاین ارائه‌دهنده خدمات مشاوره، ویزیت و آموزش است. "
        "برای رزرو نوبت از ربات تلگرام استفاده کنید.",
        "متن «درباره ما»",
    ),
    SETTING_SUPPORT_MESSAGE: (
        "پیام خود را برای پشتیبانی ارسال کنید؛ کارشناس ما در اسرع وقت پاسخ می‌دهد.",
        "متن استقبال پشتیبانی",
    ),
    SETTING_CANCELLATION_HOURS: ("2", "حداقل ساعت باقی‌مانده برای لغو نوبت"),
    SETTING_SLOT_DURATION: ("30", "مدت پیش‌فرض هر بازه (دقیقه)"),
    SETTING_MAX_DAYS_AHEAD: ("30", "حداکثر روزهای قابل رزرو از امروز"),
    SETTING_TIMEZONE: ("Asia/Tehran", "منطقه زمانی برنامه"),
}

# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------
PAGE_SIZE_TELEGRAM = 5      # rows per Telegram message
PAGE_SIZE_WEB = 15          # rows per web page

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
DIVIDER = "━━━━━━━━━━━━━━"
TRACKING_PREFIX = "APT"
