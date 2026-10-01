"""GET /users (list + search), GET /users/{id} (detail), account actions."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import select

from database.models import SupportTicket
from database.queries import user_appointments
from database.session import session_scope
from services import user_service
from utils.constants import ROLE_ADMIN, ROLE_USER
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["users"], dependencies=[Depends(require_admin)])


@router.get("/users")
async def users_page(request: Request, q: str = "", page: int = 1):
    """Paginated list with a free search over name / phone / telegram id."""
    with session_scope() as session:
        rows = user_service.list_users(session, search=q or None)
    result = paginate(rows, page, 15)
    return render(
        request,
        "users.html",
        rows=result.items,
        q=q,
        total=len(rows),
        pager=page_context(request, result.page, len(rows)),
    )


@router.get("/users/{user_id}")
async def user_detail(request: Request, user_id: int):
    """Profile, appointments and support tickets of one user."""
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            flash(request, "کاربر یافت نشد.", "err")
            return redirect_back(request, "/users")
        appointments = user_appointments(session, user_id)
        tickets = list(
            session.scalars(
                select(SupportTicket)
                .where(SupportTicket.user_id == user_id)
                .order_by(SupportTicket.created_at.desc())
            )
        )
    return render(
        request,
        "user_detail.html",
        user=user,
        appointments=appointments,
        tickets=tickets,
    )


@router.post("/users/{user_id}/toggle", dependencies=[Depends(csrf)])
async def toggle_user(request: Request, user_id: int):
    """Enable / disable an account."""
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            flash(request, "کاربر یافت نشد.", "err")
        else:
            user_service.set_active(session, user, not user.is_active)
            state = "فعال" if user.is_active else "غیرفعال"
            flash(request, f"وضعیت کاربر «{user.first_name}» به {state} تغییر کرد.")
    return redirect_back(request, "/users")


@router.post("/users/{user_id}/role", dependencies=[Depends(csrf)])
async def change_role(request: Request, user_id: int, role: str = Form(ROLE_USER)):
    """Switch between the user and admin roles (extensible design)."""
    if role not in (ROLE_USER, ROLE_ADMIN):
        flash(request, "نقش نامعتبر است.", "err")
        return redirect_back(request, "/users")
    with session_scope() as session:
        user = user_service.get_by_id(session, user_id)
        if user is None:
            flash(request, "کاربر یافت نشد.", "err")
        else:
            user_service.set_role(session, user, role)
            flash(request, "نقش کاربر به‌روزرسانی شد.")
    return redirect_back(request, "/users")
