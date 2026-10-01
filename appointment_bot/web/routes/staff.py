"""Staff management: list, create, edit, service assignment, activate/delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import select

from database.models import Service, Staff
from database.session import session_scope
from services import service_service, staff_service
from services.staff_service import StaffError
from utils.helpers import paginate
from web.auth import csrf, require_admin
from web.render import flash, page_context, redirect_back, render

router = APIRouter(tags=["staff"], dependencies=[Depends(require_admin)])


@router.get("/staff")
async def staff_page(request: Request, page: int = 1):
    with session_scope() as session:
        rows = staff_service.list_staff(session)
        services = service_service.list_services(session)
        assigned = {
            member.id: {s.id for s in staff_service.services_of(session, member.id)}
            for member in rows
        }
        hours_count = {
            member.id: len(staff_service.working_hours(session, member.id))
            for member in rows
        }
    result = paginate(rows, page, 15)
    return render(
        request,
        "staff.html",
        rows=result.items,
        services=services,
        assigned=assigned,
        hours_count=hours_count,
        pager=page_context(request, result.page, len(rows)),
    )


@router.post("/staff", dependencies=[Depends(csrf)])
async def create_staff(
    request: Request,
    name: str = Form(...),
    specialty: str = Form(""),
    phone: str = Form(""),
):
    try:
        with session_scope() as session:
            member = staff_service.create(
                session, name=name, specialty=specialty, phone=phone
            )
            flash(request, f"کارشناس «{member.name}» با ساعات کاری پیش‌فرض ایجاد شد.")
    except StaffError as exc:
        flash(request, str(exc), "err")
    return redirect_back(request, "/staff")


@router.post("/staff/{staff_id}", dependencies=[Depends(csrf)])
async def update_staff(
    request: Request,
    staff_id: int,
    name: str = Form(...),
    specialty: str = Form(""),
    phone: str = Form(""),
):
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            flash(request, "کارشناس یافت نشد.", "err")
            return redirect_back(request, "/staff")
        staff_service.update(session, member, name=name, specialty=specialty, phone=phone)
        flash(request, "اطلاعات کارشناس به‌روزرسانی شد.")
    return redirect_back(request, "/staff")


@router.post("/staff/{staff_id}/toggle", dependencies=[Depends(csrf)])
async def toggle_staff(request: Request, staff_id: int):
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            flash(request, "کارشناس یافت نشد.", "err")
        else:
            staff_service.set_active(session, member, not member.is_active)
            state = "فعال" if member.is_active else "غیرفعال"
            flash(request, f"کارشناس «{member.name}» {state} شد.")
    return redirect_back(request, "/staff")


@router.post("/staff/{staff_id}/services", dependencies=[Depends(csrf)])
async def assign_services(
    request: Request,
    staff_id: int,
    service_ids: list[int] | None = Form(None),
):
    """M:N relation: exactly which services this staff member provides."""
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            flash(request, "کارشناس یافت نشد.", "err")
            return redirect_back(request, "/staff")
        staff_service.assign_services(session, member, service_ids or [])
        flash(request, f"خدمات کارشناس «{member.name}» به‌روزرسانی شد.")
    return redirect_back(request, "/staff")


@router.post("/staff/{staff_id}/delete", dependencies=[Depends(csrf)])
async def delete_staff(request: Request, staff_id: int):
    with session_scope() as session:
        member = staff_service.get(session, staff_id)
        if member is None:
            flash(request, "کارشناس یافت نشد.", "err")
            return redirect_back(request, "/staff")
        try:
            name = member.name
            staff_service.delete(session, member)
            flash(request, f"کارشناس «{name}» حذف شد.")
        except StaffError as exc:
            flash(request, str(exc), "err")
    return redirect_back(request, "/staff")
