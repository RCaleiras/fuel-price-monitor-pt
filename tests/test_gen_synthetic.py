"""Tests for tests/perf/gen_synthetic.py: the synthetic export keeps the real days and is clearly marked."""

import copy
import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location("gen_synthetic", Path(__file__).parent / "perf" / "gen_synthetic.py")
gen_synthetic = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gen_synthetic)


def _export() -> dict:
    return {
        "dates": ["2026-10-10", "2026-10-11"],
        "coverage": {"first_date": "2026-10-10", "latest_date": "2026-10-11", "n_days": 2},
        "window_days": 30,
        "source": "DGEG",
        "prices": {
            "fields": ["station", "fuel", "prices", "updated_at"],
            "rows": [
                [0, 1, [1500, 1510], "2026-10-11T00:00:00Z"],
                [1, 1, [None, 1600], "2026-10-11T00:00:00Z"],
                [2, 1, [None, None], "2026-10-11T00:00:00Z"],
            ],
        },
        "activity": [
            {"fuel": 1, "date": "2026-10-10", "published": 2, "carried": 0, "changes": 0, "suspect": 0},
            {"fuel": 1, "date": "2026-10-11", "published": 2, "carried": 1, "changes": 1, "suspect": 0},
        ],
    }


def test_extends_every_series_to_the_requested_number_of_days():
    result = gen_synthetic.extend(_export(), 5)

    assert len(result["dates"]) == 5
    assert all(len(row[2]) == 5 for row in result["prices"]["rows"])
    assert result["dates"] == sorted(result["dates"])
    assert result["window_days"] == 5 and result["coverage"]["n_days"] == 5
    assert len(result["activity"]) == 5


def test_keeps_real_values_and_marks_the_file_as_synthetic():
    original = _export()
    snapshot = copy.deepcopy(original)

    result = gen_synthetic.extend(original, 5)

    assert result["prices"]["rows"][0][2][-2:] == [1500, 1510]
    assert result["dates"][-2:] == ["2026-10-10", "2026-10-11"]
    assert result["synthetic"] is True and "SYNTHETIC" in result["source"]
    assert original == snapshot  # the input is not mutated


def test_is_deterministic():
    assert gen_synthetic.extend(_export(), 6) == gen_synthetic.extend(_export(), 6)


def test_does_not_invent_prices_for_a_series_that_never_had_one():
    result = gen_synthetic.extend(_export(), 5)

    assert result["prices"]["rows"][2][2] == [None] * 5


def test_refuses_fewer_days_than_the_export_already_has():
    with pytest.raises(ValueError):
        gen_synthetic.extend(_export(), 1)
