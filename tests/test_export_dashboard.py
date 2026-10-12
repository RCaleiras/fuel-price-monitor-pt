import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from src import export_dashboard as ed

GENERATED_AT = datetime(2026, 10, 11, 7, 0, tzinfo=timezone.utc)


def fuels():
    return [
        {"fuel_sk": 5, "fuel_name": "Gasóleo simples", "unit": "litro", "is_fleet_fuel": True, "n_prices": 3},
        {"fuel_sk": 3, "fuel_name": "GNL (gás natural liquefeito) - €/kg", "unit": "kg", "is_fleet_fuel": False,
         "n_prices": 1},
    ]


def stations():
    return [
        {"station_code": 101, "station_name": "Posto A", "station_type": "Outro", "brand": "GALP",
         "district": "Faro", "municipality": "Faro", "locality": "Faro", "address": "Rua 1",
         "latitude": 37.01, "longitude": -7.93},
        {"station_code": 202, "station_name": "Posto B", "station_type": "Auto-estrada", "brand": "BP",
         "district": "Lisboa", "municipality": "Lisboa", "locality": "Lisboa", "address": "Av. 2",
         "latitude": None, "longitude": None},
    ]


def station_prices():
    return [
        {"station_code": 101, "fuel_sk": 5,
         "prices": [{"price_date": date(2026, 10, 9), "price_eur": Decimal("2.207")},
                    {"price_date": date(2026, 10, 11), "price_eur": Decimal("2.199")}],
         "last_price_updated_at": datetime(2026, 10, 10, 17, 55, tzinfo=timezone.utc)},
        {"station_code": 202, "fuel_sk": 3,
         "prices": [{"price_date": date(2026, 10, 11), "price_eur": Decimal("3.279")}],
         "last_price_updated_at": None},
    ]


def activity():
    return [{"fuel_sk": 5, "price_date": date(2026, 10, 11), "n_published": 2, "n_carried": 1, "n_changes": 1,
             "n_suspect": 0}]


def coverage():
    return [{"first_date": date(2026, 10, 1), "latest_date": date(2026, 10, 11), "n_days": 11}]


def query_results(**overrides):
    results = {
        "01_fuels": fuels(),
        "02_stations": stations(),
        "03_station_prices": station_prices(),
        "04_daily_activity": activity(),
        "05_coverage": coverage(),
    }
    results.update(overrides)
    return results


def build(window_days=3, **overrides):
    return ed.build_payload(query_results(**overrides), window_days=window_days, generated_at=GENERATED_AT)


def test_build_payload_lists_the_window_dates_ending_on_the_latest_day():
    assert build()["dates"] == ["2026-10-09", "2026-10-10", "2026-10-11"]


def test_build_payload_never_starts_the_window_before_the_first_collected_day():
    payload = build(window_days=30)

    assert payload["dates"][0] == "2026-10-01"
    assert payload["dates"][-1] == "2026-10-11"


def test_build_payload_aligns_prices_to_dates_in_milli_euro_with_gaps_as_null():
    payload = build()
    rows = payload["prices"]["rows"]

    assert payload["prices"]["fields"] == ["station", "fuel", "prices", "updated_at"]
    assert rows[0] == [0, 5, [2207, None, 2199], "2026-10-10T17:55:00Z"]
    assert rows[1] == [1, 3, [None, None, 3279], None]


def test_build_payload_keeps_station_attributes_by_position_and_null_coordinates():
    payload = build()

    assert payload["stations"]["fields"][0] == "code"
    assert payload["stations"]["rows"][1] == [202, "Posto B", "Auto-estrada", "BP", "Lisboa", "Lisboa", "Lisboa",
                                              "Av. 2", None, None]


def test_build_payload_carries_fuels_activity_coverage_and_metadata():
    payload = build()

    assert payload["schema_version"] == ed.SCHEMA_VERSION
    assert payload["generated_at"] == "2026-10-11T07:00:00Z"
    assert payload["window_days"] == 3
    assert payload["coverage"] == {"first_date": "2026-10-01", "latest_date": "2026-10-11", "n_days": 11}
    assert payload["fuels"][0] == {"id": 5, "name": "Gasóleo simples", "unit": "litro", "fleet": True}
    assert payload["activity"] == [{"fuel": 5, "date": "2026-10-11", "published": 2, "carried": 1, "changes": 1,
                                    "suspect": 0}]
    assert "DGEG" in payload["source"]


def test_build_payload_fails_without_coverage():
    with pytest.raises(ValueError, match="coverage"):
        build(**{"05_coverage": [{"first_date": None, "latest_date": None, "n_days": 0}]})


def test_validate_rejects_an_empty_fuel_list():
    with pytest.raises(ValueError, match="no fuels"):
        build(**{"01_fuels": [], "03_station_prices": []})


def test_validate_rejects_an_unknown_unit():
    bad = fuels()
    bad[0]["unit"] = "gallon"
    with pytest.raises(ValueError, match="unit"):
        build(**{"01_fuels": bad})


def test_validate_rejects_duplicate_stations():
    with pytest.raises(ValueError, match="duplicate station"):
        build(**{"02_stations": stations() + [stations()[0]]})


def test_validate_rejects_a_price_for_an_unknown_station():
    bad = station_prices()
    bad[0]["station_code"] = 999
    with pytest.raises(ValueError, match="unknown station"):
        build(**{"03_station_prices": bad})


def test_validate_rejects_a_price_for_an_unknown_fuel():
    bad = station_prices()
    bad[0]["fuel_sk"] = 42
    with pytest.raises(ValueError, match="unknown fuel"):
        build(**{"03_station_prices": bad})


@pytest.mark.parametrize("price", [Decimal("0"), Decimal("-1.5"), None])
def test_validate_rejects_missing_zero_or_negative_prices(price):
    bad = station_prices()
    bad[1]["prices"][0]["price_eur"] = price
    with pytest.raises(ValueError, match="price"):
        build(**{"03_station_prices": bad})


def test_validate_rejects_a_price_outside_the_window():
    bad = station_prices()
    bad[0]["prices"][0]["price_date"] = date(2026, 9, 1)
    with pytest.raises(ValueError, match="outside the window"):
        build(**{"03_station_prices": bad})


def test_validate_rejects_a_snapshot_with_no_price_on_the_latest_day():
    bad = station_prices()
    bad[0]["prices"] = bad[0]["prices"][:1]
    bad = bad[:1]
    with pytest.raises(ValueError, match="latest day"):
        build(**{"03_station_prices": bad})


def test_validate_rejects_too_many_pairs(monkeypatch):
    monkeypatch.setattr(ed, "MAX_PAIRS", 1)
    with pytest.raises(ValueError, match="pairs"):
        build()


def test_run_query_passes_the_window_parameter_and_the_cost_caps(tmp_path):
    path = tmp_path / "01_fuels.sql"
    path.write_text("SELECT @window_days", encoding="utf-8")
    client = MagicMock()
    client.query.return_value.result.return_value = [{"a": 1}]

    rows = ed.run_query(client, path, window_days=30)

    assert rows == [{"a": 1}]
    sql, = client.query.call_args.args
    config = client.query.call_args.kwargs["job_config"]
    assert sql == "SELECT @window_days"
    assert config.maximum_bytes_billed == ed.MAX_BYTES_BILLED
    assert int(config.job_timeout_ms) == ed.JOB_TIMEOUT_MS
    (param,) = config.query_parameters
    assert (param.name, param.type_, param.value) == ("window_days", "INT64", 30)


def test_run_query_propagates_failures(tmp_path):
    path = tmp_path / "01_fuels.sql"
    path.write_text("SELECT 1", encoding="utf-8")
    client = MagicMock()
    client.query.return_value.result.side_effect = RuntimeError("quota")

    with pytest.raises(RuntimeError, match="quota"):
        ed.run_query(client, path, window_days=30)


def test_query_files_are_the_dashboard_scripts_in_order():
    names = [p.stem for p in ed.query_files()]

    assert names == ["01_fuels", "02_stations", "03_station_prices", "04_daily_activity", "05_coverage"]


def test_write_payload_writes_compact_utf8_json(tmp_path):
    payload = build()

    path = ed.write_payload(payload, tmp_path / "data")

    text = path.read_text(encoding="utf-8")
    assert path.name == ed.OUTPUT_FILE
    assert "Gasóleo" in text
    assert text == json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    assert json.loads(text) == payload


def test_write_payload_refuses_an_oversized_file_and_leaves_no_output(tmp_path, monkeypatch):
    monkeypatch.setattr(ed, "MAX_OUTPUT_BYTES", 10)

    with pytest.raises(ValueError, match="too large"):
        ed.write_payload(build(), tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_main_exports_every_query_and_writes_the_file(monkeypatch, tmp_path):
    results = query_results()
    client = MagicMock()
    monkeypatch.setattr(ed, "build_client", lambda: client)
    monkeypatch.setattr(ed, "run_query", lambda c, path, window_days: results[path.stem])

    ed.main(["--out", str(tmp_path), "--window-days", "3"])

    payload = json.loads((tmp_path / ed.OUTPUT_FILE).read_text(encoding="utf-8"))
    assert payload["dates"] == ["2026-10-09", "2026-10-10", "2026-10-11"]


def test_main_writes_nothing_when_validation_fails(monkeypatch, tmp_path):
    results = query_results(**{"01_fuels": []})
    monkeypatch.setattr(ed, "build_client", MagicMock)
    monkeypatch.setattr(ed, "run_query", lambda c, path, window_days: results[path.stem])

    with pytest.raises(ValueError):
        ed.main(["--out", str(tmp_path)])
    assert not (tmp_path / ed.OUTPUT_FILE).exists()


def test_main_rejects_a_window_out_of_range(tmp_path):
    with pytest.raises(SystemExit):
        ed.main(["--out", str(tmp_path), "--window-days", "0"])


# ---------- Phase 1: up to 90 days of recent per-station history ----------


def long_history_results(first: date, latest: date, n_stations: int = 40, n_fuels: int = 3):
    """Every station x fuel pair published on every day of the last 90 days up to `latest` (synthetic, for limits
    only). Coverage still starts at `first`: the SQL only returns prices inside the window."""
    n_days = (latest - first).days + 1
    days = [latest - timedelta(days=i) for i in reversed(range(min(n_days, ed.MAX_WINDOW_DAYS)))]
    fuel_rows = [{"fuel_sk": f, "fuel_name": f"Fuel {f}", "unit": "litro", "is_fleet_fuel": True, "n_prices": 1}
                 for f in range(1, n_fuels + 1)]
    station_rows = [{"station_code": 1000 + s, "station_name": f"S{s}", "station_type": "Outro", "brand": "B",
                     "district": "D", "municipality": "M", "locality": "L", "address": "A", "latitude": 38.0,
                     "longitude": -9.0} for s in range(n_stations)]
    pairs = [{"station_code": 1000 + s, "fuel_sk": f,
              "prices": [{"price_date": d, "price_eur": Decimal("1.700")} for d in days],
              "last_price_updated_at": None}
             for s in range(n_stations) for f in range(1, n_fuels + 1)]
    return {
        "01_fuels": fuel_rows, "02_stations": station_rows, "03_station_prices": pairs,
        "04_daily_activity": [],
        "05_coverage": [{"first_date": first, "latest_date": latest, "n_days": len(days)}],
    }


def test_the_default_window_is_the_90_day_maximum():
    assert ed.DEFAULT_WINDOW_DAYS == 90
    assert ed.MAX_WINDOW_DAYS == 90


def test_main_uses_the_90_day_window_by_default(monkeypatch, tmp_path):
    results = query_results()
    seen = []
    monkeypatch.setattr(ed, "build_client", MagicMock)

    def fake_run(client, path, window_days):
        seen.append(window_days)
        return results[path.stem]

    monkeypatch.setattr(ed, "run_query", fake_run)

    ed.main(["--out", str(tmp_path)])

    assert set(seen) == {90}
    assert json.loads((tmp_path / ed.OUTPUT_FILE).read_text(encoding="utf-8"))["window_days"] == 90


def test_a_full_history_is_cut_to_exactly_90_days_ending_on_the_latest_day():
    results = long_history_results(date(2026, 6, 1), date(2026, 10, 11))

    payload = ed.build_payload(results, window_days=90, generated_at=GENERATED_AT)

    assert len(payload["dates"]) == 90
    assert payload["dates"][0] == "2026-07-14"
    assert payload["dates"][-1] == "2026-10-11"
    assert payload["coverage"]["first_date"] == "2026-06-01"


def test_with_fewer_than_90_days_collected_only_the_days_that_exist_are_shown():
    payload = build(window_days=90)

    assert len(payload["dates"]) == 11
    assert payload["dates"][0] == payload["coverage"]["first_date"]
    assert payload["window_days"] == 90


def test_days_without_a_published_price_stay_null_and_are_never_filled():
    results = long_history_results(date(2026, 7, 1), date(2026, 10, 11), n_stations=1, n_fuels=1)
    only_two = [p for p in results["03_station_prices"][0]["prices"]
                if p["price_date"] in (date(2026, 8, 1), date(2026, 10, 11))]
    results["03_station_prices"][0]["prices"] = only_two

    payload = ed.build_payload(results, window_days=90, generated_at=GENERATED_AT)

    cells = payload["prices"]["rows"][0][2]
    assert len(cells) == 90
    assert [c for c in cells if c is not None] == [1700, 1700]
    assert cells.count(None) == 88


def test_validate_rejects_the_same_station_and_fuel_twice():
    twice = station_prices() + [station_prices()[0]]
    with pytest.raises(ValueError, match="duplicate"):
        build(**{"03_station_prices": twice})


def test_a_full_90_day_file_for_a_realistic_number_of_pairs_fits_under_the_size_cap(tmp_path):
    # 3,300 stations x 4.4 fuels on average ~ 14,500 pairs (2026-10-12: 14,432), every cell filled = worst case
    results = long_history_results(date(2026, 7, 14), date(2026, 10, 11), n_stations=3300, n_fuels=4)

    payload = ed.build_payload(results, window_days=90, generated_at=GENERATED_AT)
    path = ed.write_payload(payload, tmp_path)

    assert len(payload["prices"]["rows"]) == 13_200
    assert path.stat().st_size < ed.MAX_OUTPUT_BYTES
    assert path.stat().st_size > 0.5 * 13_200 * 90 * 5  # sanity: the cells really are in the file


def test_main_rejects_a_window_above_90_days(tmp_path):
    with pytest.raises(SystemExit):
        ed.main(["--out", str(tmp_path), "--window-days", "91"])
