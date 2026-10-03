"""Freshness check: fail loudly if no station prices were collected today (UTC).

Called by .github/workflows/freshness.yml as `python -m src.check_freshness`.
Catches both a failed collector run and a schedule that GitHub never started.
"""

import logging
import os
import sys
from datetime import date, datetime, timezone

from src.collect import STATIONS_TABLE, build_client

log = logging.getLogger(__name__)


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def is_fresh(latest: date | None, today: date) -> bool:
    return latest == today


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    client = build_client()
    table = f"`{client.project}.{os.environ['BQ_DATASET']}.{STATIONS_TABLE}`"
    query = f"SELECT MAX(DATE(collected_at)) AS latest FROM {table}"
    latest = next(iter(client.query(query).result())).latest
    today = utc_today()

    if is_fresh(latest, today):
        log.info("OK: station prices collected today (%s).", today)
        return

    log.error("STALE: latest collection is %s, expected %s.", latest, today)
    sys.exit(1)


if __name__ == "__main__":
    main()
