"""Global settings (same ``settings`` table used by the Telegram panel)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import select

from database.models import Setting
from database.session import session_scope
from services import settings_service
from utils.constants import SETTINGS_DEFAULTS
from web.auth import csrf, require_admin
from web.render import flash, redirect_back, render

router = APIRouter(tags=["settings"], dependencies=[Depends(require_admin)])


@router.get("/settings")
async def settings_page(request: Request):
    with session_scope() as session:
        rows = settings_service.get_described_settings(session)
    return render(request, "settings.html", rows=rows)


@router.post("/settings", dependencies=[Depends(csrf)])
async def save_settings(request: Request, values: str = Form("{}")):
    """
    Save every edited row.

    ``values`` is a JSON object {key: value} built by the page, so one submit
    updates several settings at once.
    """
    import json

    try:
        payload = json.loads(values)
        if not isinstance(payload, dict):
            raise ValueError
    except ValueError:
        flash(request, "داده ارسالی نامعتبر است.", "err")
        return redirect_back(request, "/settings")

    saved = 0
    with session_scope() as session:
        for key, value in payload.items():
            if not isinstance(key, str) or not isinstance(value, str):
                continue
            if key not in SETTINGS_DEFAULTS and session.get(Setting, key) is None:
                continue  # never create unknown keys from the web panel
            settings_service.set_setting(session, key, value)
            saved += 1
    flash(request, f"{saved} تنظیم ذخیره شد.")
    return redirect_back(request, "/settings")


@router.post("/settings/reset", dependencies=[Depends(csrf)])
async def reset_settings(request: Request):
    """Clear the stored values -> the built-in defaults are used again."""
    with session_scope() as session:
        for row in session.scalars(select(Setting)):
            if row.key in SETTINGS_DEFAULTS:
                session.delete(row)
    flash(request, "تنظیمات به حالت پیش‌فرض بازگردانده شد.")
    return redirect_back(request, "/settings")
