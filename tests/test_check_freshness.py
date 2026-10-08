from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import pytest

from src import check_freshness

TODAY = date(2026, 10, 3)


def test_is_fresh_when_latest_collection_is_today():
    assert check_freshness.is_fresh(TODAY, TODAY)


def test_is_not_fresh_when_latest_collection_is_yesterday():
    assert not check_freshness.is_fresh(date(2026, 10, 2), TODAY)


def test_is_not_fresh_when_table_is_empty():
    assert not check_freshness.is_fresh(None, TODAY)


def test_expected_date_is_same_day_when_check_runs_on_time():
    now = datetime(2026, 10, 7, 20, 30, tzinfo=timezone.utc)
    assert check_freshness.expected_date(now) == date(2026, 10, 7)


def test_expected_date_is_previous_day_when_github_delays_the_check_past_midnight():
    now = datetime(2026, 10, 8, 0, 20, tzinfo=timezone.utc)
    assert check_freshness.expected_date(now) == date(2026, 10, 7)


def test_expected_date_moves_to_new_day_after_the_grace_window():
    now = datetime(2026, 10, 8, 3, 0, tzinfo=timezone.utc)
    assert check_freshness.expected_date(now) == date(2026, 10, 8)


def _client_returning(latest):
    client = MagicMock()
    client.query.return_value.result.return_value = iter([MagicMock(latest=latest)])
    return client


def test_main_passes_when_data_is_from_today(monkeypatch):
    monkeypatch.setattr(check_freshness, "build_client", lambda: _client_returning(TODAY))
    monkeypatch.setattr(check_freshness, "expected_date", lambda now=None: TODAY)
    monkeypatch.setenv("BQ_DATASET", "fuel_monitor")

    check_freshness.main()


def test_main_fails_when_today_is_missing(monkeypatch):
    monkeypatch.setattr(check_freshness, "build_client", lambda: _client_returning(date(2026, 10, 2)))
    monkeypatch.setattr(check_freshness, "expected_date", lambda now=None: TODAY)
    monkeypatch.setenv("BQ_DATASET", "fuel_monitor")

    with pytest.raises(SystemExit) as exc:
        check_freshness.main()

    assert exc.value.code == 1
