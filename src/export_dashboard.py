"""Dashboard export: run the fixed queries in sql/dashboard/ and write one validated JSON file for the public site.

Called by .github/workflows/collect.yml as `python -m src.export_dashboard --out site/data`, after Build models.
Locally: `python -m src.export_dashboard --out site/data`, then `python -m http.server -d site`.

The browser never talks to BigQuery: it only reads this file. The queries read the report view only, with one parameter
(the window in days), a bytes cap and a timeout. Prices are published prices only (observed_that_day, not suspect).
If any check fails, nothing is written, so the deploy step never publishes a broken or partial snapshot.
"""

import argparse
import json
import logging
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.cloud import bigquery

from src.collect import build_client

QUERIES_DIR = Path(__file__).resolve().parent.parent / "sql" / "dashboard"
OUTPUT_FILE = "dashboard.json"
SCHEMA_VERSION = 1
SOURCE = "Direção-Geral de Energia e Geologia (DGEG), preços de combustíveis por posto, CC BY 4.0"

DEFAULT_WINDOW_DAYS = 30  # also hardcoded in sql/tests/dashboard_*.sql (INTERVAL 29 DAY)
MAX_WINDOW_DAYS = 90
MAX_BYTES_BILLED = 1_000_000_000  # 1 GB per query; each run bills ~50 MB per query today
JOB_TIMEOUT_MS = 120_000
MAX_PAIRS = 100_000  # station x fuel pairs; ~14k today
MAX_OUTPUT_BYTES = 15_000_000
UNITS = {"litro", "kg", "m3"}

STATION_FIELDS = ["code", "name", "type", "brand", "district", "municipality", "locality", "address", "lat", "lon"]
STATION_COLUMNS = ["station_code", "station_name", "station_type", "brand", "district", "municipality", "locality",
                   "address", "latitude", "longitude"]

log = logging.getLogger("export_dashboard")


def query_files() -> list[Path]:
    """The export queries, in name order; fail if there are none (a wrong path must not pass silently)."""
    files = sorted(QUERIES_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no .sql files found in {QUERIES_DIR}")
    return files


def run_query(client: bigquery.Client, path: Path, window_days: int) -> list[dict[str, Any]]:
    """Run one export query with the window parameter and the cost caps; return its rows as dicts."""
    config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("window_days", "INT64", window_days)],
        maximum_bytes_billed=MAX_BYTES_BILLED,
        job_timeout_ms=JOB_TIMEOUT_MS,
    )
    log.info("running %s", path.name)
    rows = client.query(path.read_text(encoding="utf-8"), job_config=config).result()
    return [dict(row.items()) if hasattr(row, "items") else dict(row) for row in rows]


def iso_utc(value: datetime | None) -> str | None:
    """A timestamp as `YYYY-MM-DDTHH:MM:SSZ` (UTC), or None."""
    if value is None:
        return None
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def milli_euro(value: Decimal | None) -> int:
    """2.207 EUR -> 2207. Integers keep the file small and avoid float rounding in the browser."""
    if value is None or value <= 0:
        raise ValueError(f"invalid price {value!r}: published prices must be positive")
    return int((value * 1000).to_integral_value())


def window_dates(first: date, latest: date, window_days: int) -> list[date]:
    """The days shown: up to `window_days` days ending on the latest day, never before the first collected day."""
    start = max(first, latest - timedelta(days=window_days - 1))
    return [start + timedelta(days=i) for i in range((latest - start).days + 1)]


def build_payload(results: dict[str, list[dict]], window_days: int, generated_at: datetime) -> dict[str, Any]:
    """Turn the query rows into the compact JSON the site reads, and validate it."""
    (coverage,) = results["05_coverage"]
    if coverage["latest_date"] is None or coverage["first_date"] is None:
        raise ValueError("no coverage: the report view returned no days")
    dates = window_dates(coverage["first_date"], coverage["latest_date"], window_days)
    date_index = {d: i for i, d in enumerate(dates)}

    fuels = [
        {"id": f["fuel_sk"], "name": f["fuel_name"], "unit": f["unit"], "fleet": f["is_fleet_fuel"]}
        for f in results["01_fuels"]
    ]
    station_rows = [[s[c] for c in STATION_COLUMNS] for s in results["02_stations"]]
    station_index: dict[int, int] = {}
    for i, row in enumerate(station_rows):
        if row[0] in station_index:
            raise ValueError(f"duplicate station {row[0]} in the stations query")
        station_index[row[0]] = i

    fuel_ids = {f["id"] for f in fuels}
    price_rows = []
    for pair in results["03_station_prices"]:
        if pair["station_code"] not in station_index:
            raise ValueError(f"price for unknown station {pair['station_code']}")
        if pair["fuel_sk"] not in fuel_ids:
            raise ValueError(f"price for unknown fuel {pair['fuel_sk']}")
        aligned: list[int | None] = [None] * len(dates)
        for point in pair["prices"]:
            if point["price_date"] not in date_index:
                raise ValueError(f"price date {point['price_date']} outside the window")
            aligned[date_index[point["price_date"]]] = milli_euro(point["price_eur"])
        price_rows.append([station_index[pair["station_code"]], pair["fuel_sk"], aligned,
                           iso_utc(pair["last_price_updated_at"])])

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": iso_utc(generated_at),
        "source": SOURCE,
        "window_days": window_days,
        "coverage": {
            "first_date": coverage["first_date"].isoformat(),
            "latest_date": coverage["latest_date"].isoformat(),
            "n_days": coverage["n_days"],
        },
        "dates": [d.isoformat() for d in dates],
        "fuels": fuels,
        "stations": {"fields": STATION_FIELDS, "rows": station_rows},
        "prices": {"fields": ["station", "fuel", "prices", "updated_at"], "rows": price_rows},
        "activity": [
            {"fuel": a["fuel_sk"], "date": a["price_date"].isoformat(), "published": a["n_published"],
             "carried": a["n_carried"], "changes": a["n_changes"], "suspect": a["n_suspect"]}
            for a in results["04_daily_activity"]
        ],
    }
    validate(payload)
    return payload


def validate(payload: dict[str, Any]) -> None:
    """Checks the site relies on; any failure stops the export before a file is written."""
    fuels = payload["fuels"]
    if not fuels:
        raise ValueError("no fuels in the window")
    if len({f["id"] for f in fuels}) != len(fuels):
        raise ValueError("duplicate fuel ids")
    bad_units = {f["unit"] for f in fuels} - UNITS
    if bad_units:
        raise ValueError(f"unexpected unit(s) {sorted(bad_units)}")
    rows = payload["prices"]["rows"]
    if len(rows) > MAX_PAIRS:
        raise ValueError(f"{len(rows)} station x fuel pairs, more than the limit {MAX_PAIRS}")
    if not any(row[2][-1] is not None for row in rows):
        raise ValueError(f"no published price on the latest day {payload['dates'][-1]}")


def write_payload(payload: dict[str, Any], out_dir: Path) -> Path:
    """Write the JSON atomically (temp file, then rename); refuse a file larger than the limit."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    size = len(text.encode("utf-8"))
    if size > MAX_OUTPUT_BYTES:
        raise ValueError(f"dashboard file too large: {size} bytes (limit {MAX_OUTPUT_BYTES})")
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / OUTPUT_FILE
    fd, tmp = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    log.info("wrote %s (%d bytes, %d pairs)", target, size, len(payload["prices"]["rows"]))
    return target


def window_arg(value: str) -> int:
    days = int(value)
    if not 1 <= days <= MAX_WINDOW_DAYS:
        raise argparse.ArgumentTypeError(f"window must be between 1 and {MAX_WINDOW_DAYS} days")
    return days


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("site/data"), help="output folder")
    parser.add_argument("--window-days", type=window_arg, default=DEFAULT_WINDOW_DAYS)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()
    client = build_client()
    results = {path.stem: run_query(client, path, args.window_days) for path in query_files()}
    payload = build_payload(results, window_days=args.window_days, generated_at=datetime.now(timezone.utc))
    write_payload(payload, args.out)


if __name__ == "__main__":
    main()
