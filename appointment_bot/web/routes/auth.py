"""GET /login, POST /login, POST /logout."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse

from web.auth import new_csrf_token, open_session, verify_credentials, verify_csrf
from web.render import flash, render

router = APIRouter(tags=["auth"])


@router.get("/login")
async def login_page(request: Request):
    """Login form (the only page that does not require a session)."""
    if request.session.get("web_admin"):
        return RedirectResponse("/", status_code=303)
    new_csrf_token(request)  # issues the token stored in the session cookie
    return render(request, "login.html", username="")


@router.post("/login", dependencies=[Depends(verify_csrf)])
async def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    """Check the credentials from .env and open the session."""
    username = username.strip()
    if not verify_credentials(username, password):
        flash(request, "نام کاربری یا گذرواژه اشتباه است.", "err")
        return render(request, "login.html", status_code=401, username=username)
    open_session(request, username)
    return RedirectResponse("/", status_code=303)


@router.post("/logout")
async def logout(request: Request):
    """Close the session (the CSRF token of the form is not checked here -
    logging out can not harm the visitor)."""
    request.session.clear()
    response = RedirectResponse("/login", status_code=303)
    return response
