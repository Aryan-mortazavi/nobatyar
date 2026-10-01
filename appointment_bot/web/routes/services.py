"""Service catalog: list, create, edit, activate/deactivate, delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request

from database.session import session_scope
from services import service_service
from services.service_service import ServiceError
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["services"], dependencies=[Depends(require_admin)])


@router.get("/services")
async def services_page(request: Request, q: str = "", page: int = 1):
    with session_scope() as session:
        rows = service_service.list_services(session, search=q or None)
        staff_rows = _staff_names(session)
    result = paginate(rows, page, 15)
    return render(
        request,
        "services.html",
        rows=result.items,
        q=q,
        total=len(rows),
        staff_names=staff_rows,
        pager=page_context(request, result.page, len(rows)),
    )


def _staff_names(session) -> dict[int, str]:
    from sqlalchemy import select

    from database.models import Staff

    return {row.id: row.name for row in session.scalars(select(Staff))}


@router.post("/services", dependencies=[Depends(csrf)])
async def create_service(
    request: Request,
    name: str = Form(...),
    description: str = Form(""),
    duration: int = Form(30),
    price: int = Form(0),
):
    try:
        with session_scope() as session:
            service_service.create(
                session,
                name=name,
                description=description,
                duration=duration,
                price=price,
                is_active=True,
            )
        flash(request, f"خدمت «{name.strip()}» ایجاد شد.")
    except ServiceError as exc:
        flash(request, str(exc), "err")
    except Exception:  # pragma: no cover - unexpected DB error
        flash(request, "خطا در ذخیره‌سازی؛ دوباره تلاش کنید.", "err")
    return redirect_back(request, "/services")


@router.post("/services/{service_id}", dependencies=[Depends(csrf)])
async def update_service(
    request: Request,
    service_id: int,
    name: str = Form(...),
    description: str = Form(""),
    duration: int = Form(30),
    price: int = Form(0),
):
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            flash(request, "خدمت یافت نشد.", "err")
            return redirect_back(request, "/services")
        try:
            service_service.update(
                session,
                service,
                name=name,
                description=description,
                duration=duration,
                price=price,
            )
            flash(request, "خدمت به‌روزرسانی شد.")
        except ServiceError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/services")


@router.post("/services/{service_id}/toggle", dependencies=[Depends(csrf)])
async def toggle_service(request: Request, service_id: int):
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            flash(request, "خدمت یافت نشد.", "err")
        else:
            service_service.set_active(session, service, not service.is_active)
            state = "فعال" if service.is_active else "غیرفعال"
            flash(request, f"خدمت «{service.name}» {state} شد.")
    return redirect_back(request, "/services")


@router.post("/services/{service_id}/delete", dependencies=[Depends(csrf)])
async def delete_service(request: Request, service_id: int):
    with session_scope() as session:
        service = service_service.get(session, service_id)
        if service is None:
            flash(request, "خدمت یافت نشد.", "err")
            return redirect_back(request, "/services")
        try:
            name = service.name
            service_service.delete(session, service)
            flash(request, f"خدمت «{name}» حذف شد.")
        except ServiceError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/services")
