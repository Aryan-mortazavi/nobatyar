"""گزارش‌های روزانه و ماهانه (شمسی) که در هر دو پنل مدیریت نمایش داده می‌شوند."""

from __future__ import annotations

from datetime import time, timedelta

from services import appointment_service, report_service
from utils.helpers import jalali_ym


def _make_appointments(session, team):
    day = team["day"]
    first = appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=day,
        start=time(9, 0),
    )
    second = appointment_service.create_appointment(
        session,
        user=team["user"],
        service_id=team["service"].id,
        staff_id=team["staff"].id,
        day=day,
        start=time(10, 0),
    )
    appointment_service.cancel(session, second)
    session.commit()
    return first, second


def test_daily_report_counts(session, team):
    first, second = _make_appointments(session, team)
    report = report_service.daily_report(session, team["day"])

    assert report["counts"]["total"] == 2
    assert report["counts"]["confirmed"] == 1
    assert report["counts"]["cancelled"] == 1
    assert report["counts"]["active"] == 1
    assert len(report["appointments"]) == 2
    assert "1405/" in report["label"]
    assert "(" in report["label"] and ")" in report["label"]  # نام روز هفته


def test_daily_report_can_be_filtered_by_status(session, team):
    _make_appointments(session, team)
    report = report_service.daily_report(session, team["day"], status="cancelled")
    assert report["counts"]["total"] == 1
    assert report["appointments"][0].status == "cancelled"

    report = report_service.daily_report(session, team["day"] + timedelta(days=9))
    assert report["counts"]["total"] == 0
    assert report["appointments"] == []


def test_monthly_report_totals_and_load(session, team):
    _make_appointments(session, team)
    year, month = jalali_ym(team["day"])
    report = report_service.monthly_report(session, year, month)

    assert report["total"] == 2
    assert report["counts"]["confirmed"] == 1
    assert report["counts"]["cancelled"] == 1
    assert report["new_users"] >= 1
    assert report["top_services"][0][0] == team["service"].name
    assert report["per_staff"][0][0] == team["staff"].name
    assert report["start"] <= team["day"] <= report["end"]


def test_monthly_report_of_an_empty_month(session, team):
    year, month = jalali_ym(team["day"])
    empty_month = month + 1 if month < 12 else 1
    report = report_service.monthly_report(session, year, empty_month)
    assert report["total"] == 0
    assert report["top_services"] == []
    assert report["per_staff"] == []


def test_formatted_reports_are_persian(session, team):
    _make_appointments(session, team)
    year, month = jalali_ym(team["day"])

    daily = report_service.format_daily(report_service.daily_report(session, team["day"]))
    assert "گزارش روزانه" in daily
    assert "کل نوبت‌ها: 2" in daily
    assert "APT-" in daily

    monthly = report_service.format_monthly(report_service.monthly_report(session, year, month))
    assert "گزارش ماهانه" in monthly
    assert "پرطرفدارترین خدمات" in monthly
    assert team["service"].name in monthly


def test_report_uses_active_status_summary(session, team):
    """dashboard-style helpers must agree with the daily report."""
    from database import queries

    _make_appointments(session, team)
    by_status = queries.appointments_by_status(session)
    report = report_service.daily_report(session, team["day"])

    assert by_status["confirmed"] == report["counts"]["confirmed"]
    assert by_status["cancelled"] == report["counts"]["cancelled"]
