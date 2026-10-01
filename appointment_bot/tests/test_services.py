"""خدمات: CRUD، اعتبارسنجی، فعال/غیرفعال و ارتباط M:N با کارشناسان."""

from __future__ import annotations

import pytest

from database.models import Staff
from services import appointment_service, service_service, staff_service
from services.service_service import ServiceError
from datetime import time


def test_create_service_defaults(session):
    service = service_service.create(session, name="مشاوره", duration=45, price=200000)
    assert service.id is not None
    assert service.duration == 45
    assert service.price == 200000
    assert service.is_active is True
    assert service.is_demo is False


def test_duplicate_name_is_rejected(session):
    service_service.create(session, name="ویزیت")
    with pytest.raises(ServiceError) as exc:
        service_service.create(session, name="ویزیت")
    assert "از قبل وجود دارد" in str(exc.value)


def test_empty_name_and_bad_duration_are_rejected(session):
    with pytest.raises(ServiceError):
        service_service.create(session, name="   ")
    with pytest.raises(ServiceError):
        service_service.create(session, name="خدمت جدید", duration=0)


def test_update_service(session):
    service = service_service.create(session, name="اولیه", duration=30, price=1000)
    service_service.update(
        session, service, name="به‌روز شده", duration=60, price=5000, description="توضیح"
    )
    session.flush()
    assert (service.name, service.duration, service.price) == ("به‌روز شده", 60, 5000)
    assert service.description == "توضیح"


def test_update_cannot_take_another_service_name(session):
    service_service.create(session, name="الف")
    other = service_service.create(session, name="ب")
    with pytest.raises(ServiceError):
        service_service.update(session, other, name="الف")


def test_active_flag(session):
    service = service_service.create(session, name="غیرفعالی")
    service_service.set_active(session, service, False)
    session.flush()
    assert service.is_active is False
    with pytest.raises(ServiceError):
        service_service.get_active(session, service.id)

    service_service.set_active(session, service, True)
    session.flush()
    assert service_service.get_active(session, service.id).is_active is True


def test_delete_free_service(session):
    service = service_service.create(session, name="بدون نوبت")
    service_service.delete(session, service)
    session.flush()
    assert service_service.get(session, service.id) is None


def test_delete_service_with_appointments_is_blocked(session, team):
    appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=team["day"],
        start=time(9, 0),
    )
    session.commit()
    with pytest.raises(ServiceError) as exc:
        service_service.delete(session, team["service"])
    assert "غیرفعال" in str(exc.value)


def test_many_to_many_assignment(session):
    svc_a = service_service.create(session, name="خدمت الف")
    svc_b = service_service.create(session, name="خدمت ب")
    member = staff_service.create(session, name="کارشناس اول")

    staff_service.assign_services(session, member, [svc_a.id])
    assert [s.id for s in staff_service.services_of(session, member.id)] == [svc_a.id]

    staff_service.assign_services(session, member, [svc_a.id, svc_b.id])
    assert len(staff_service.services_of(session, member.id)) == 2

    # removing every service is allowed
    staff_service.assign_services(session, member, [])
    assert staff_service.services_of(session, member.id) == []


def test_staff_for_service_only_active_staff(session):
    svc = service_service.create(session, name="خدمت")
    active = staff_service.create(session, name="فعال")
    inactive = staff_service.create(session, name="غیرفعال")
    staff_service.assign_services(session, active, [svc.id])
    staff_service.assign_services(session, inactive, [svc.id])
    staff_service.set_active(session, inactive, False)

    result = service_service.staff_for_service(session, svc.id)
    assert [m.id for m in result] == [active.id]


def test_service_search(session):
    service_service.create(session, name="آزمایش خون")
    service_service.create(session, name="ویزیت متخصص")
    assert len(service_service.list_services(session, search="خون")) == 1
    assert len(service_service.list_services(session)) == 2
