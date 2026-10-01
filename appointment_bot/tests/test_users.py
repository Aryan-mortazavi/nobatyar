"""کاربران: ثبت‌نام، ویرایش پروفایل، نقش‌ها و جستجو."""

from __future__ import annotations

import pytest

from services import user_service
from utils.constants import ROLE_ADMIN, ROLE_USER


def test_registration_is_idempotent(session):
    user, created = user_service.get_or_create(
        session, telegram_id=111, first_name="علی", phone="09121111111"
    )
    assert created is True
    assert user.role == ROLE_USER
    assert user.is_active is True

    same, created_again = user_service.get_or_create(
        session, telegram_id=111, first_name="علی", phone="09121111111"
    )
    assert created_again is False
    assert same.id == user.id
    assert user_service.list_users(session) and len(user_service.list_users(session)) == 1


def test_full_name_and_registration_date(session):
    user, _ = user_service.get_or_create(
        session, telegram_id=222, first_name="سارا", last_name="محمدی"
    )
    assert user.full_name == "سارا محمدی"
    assert user.created_at is not None


def test_update_profile(session):
    user, _ = user_service.get_or_create(
        session, telegram_id=333, first_name="رضا", last_name="کریمی", phone="0912"
    )
    user_service.update_profile(
        session, user, first_name="رضا علی", last_name="کریمی‌نژاد", phone="09123456789"
    )
    session.flush()
    assert user.first_name == "رضا علی"
    assert user.last_name == "کریمی‌نژاد"
    assert user.phone == "09123456789"


def test_role_and_active_flags(session):
    user, _ = user_service.get_or_create(session, telegram_id=444, first_name="مریم")
    user_service.set_role(session, user, ROLE_ADMIN)
    user_service.set_active(session, user, False)
    session.flush()
    assert user.role == ROLE_ADMIN
    assert user.is_active is False

    user_service.set_role(session, user, ROLE_USER)
    user_service.set_active(session, user, True)
    session.flush()
    assert user.role == ROLE_USER
    assert user.is_active is True


def test_search_by_name_and_phone(session):
    user_service.get_or_create(
        session, telegram_id=555, first_name="نگار", last_name="اکبری", phone="09129999999"
    )
    user_service.get_or_create(
        session, telegram_id=666, first_name="امیر", last_name="قوی", phone="09128888888"
    )
    assert len(user_service.list_users(session, search="نگار")) == 1
    assert len(user_service.list_users(session, search="09128888888")) == 1
    assert len(user_service.list_users(session, search="666")) == 1
    assert len(user_service.list_users(session)) == 2


def test_apply_admin_roles_from_env(session):
    user_service.get_or_create(session, telegram_id=1000, first_name="مدیر")
    user_service.get_or_create(session, telegram_id=2000, first_name="کاربر")

    updated = user_service.apply_admin_roles(session, [1000])
    session.flush()

    assert updated == 1
    admin = user_service.get_by_telegram(session, 1000)
    normal = user_service.get_by_telegram(session, 2000)
    assert admin.role == ROLE_ADMIN
    assert normal.role == ROLE_USER

    # running it again does nothing (already in sync)
    assert user_service.apply_admin_roles(session, [1000]) == 0


def test_count_appointments_of_user(session, team):
    assert user_service.count_appointments(session, team["user"].id) == 0
