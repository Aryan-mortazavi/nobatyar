"""
Web panel authentication.

    * credentials come from the .env file (WEB_ADMIN_USERNAME / WEB_ADMIN_PASSWORD)
    * the session cookie is signed by Starlette's SessionMiddleware
    * every state changing request must carry the ``csrf`` token of the session
"""

from __future__ import annotations

import secrets

from fastapi import Depends, Form, HTTPException, Request

from services import auth_service


def new_csrf_token(request: Request) -> str:
    """Create (or reuse) the anti-CSRF token of this session."""
    token = request.session.get("csrf")
    if not token:
        token = secrets.token_urlsafe(24)
        request.session["csrf"] = token
    return token


def require_admin(request: Request) -> str:
    """Dependency protecting every page of the panel (except /login)."""
    if not request.session.get("web_admin"):
        # 303 + Location -> the browser is redirected to the login page
        raise HTTPException(
            status_code=303, headers={"Location": "/login"}, detail="ورود لازم است"
        )
    return str(request.session["web_admin"])


async def verify_csrf(request: Request, csrf: str = Form("")) -> None:
    """Reject any POST that does not carry the token of the current session."""
    expected = request.session.get("csrf", "")
    if not expected or not secrets.compare_digest(csrf or "", expected):
        raise HTTPException(status_code=400, detail="توکن امنیتی نامعتبر است (صفحه را دوباره باز کنید).")


def verify_credentials(username: str, password: str) -> bool:
    """Constant time comparison against WEB_ADMIN_* from the .env file."""
    return auth_service.web_credentials_valid(username, password)


def open_session(request: Request, username: str) -> None:
    """Start a signed session for the web admin."""
    request.session.clear()
    request.session["web_admin"] = username
    request.session["csrf"] = secrets.token_urlsafe(24)


# ``csrf`` is the plain callable, used as ``dependencies=[Depends(csrf)]``
csrf = verify_csrf
admin = require_admin

__all__ = [
    "require_admin",
    "verify_csrf",
    "new_csrf_token",
    "verify_credentials",
    "open_session",
    "csrf",
    "admin",
]
