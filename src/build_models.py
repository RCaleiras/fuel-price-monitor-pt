"""Model builder: run the SQL files in sql/staging/ and then sql/models/ against BigQuery, each in file-name order.

Called by .github/workflows/collect.yml as `python -m src.build_models`, right after the collector.
Staging goes first: the staging table is rebuilt in full, and the models read it. Running everything twice changes nothing
(the dimensions only add what is missing, the staging table and the fact are rebuilt from the same raw data).
"""

import logging
from pathlib import Path

from google.cloud import bigquery

from src.collect import build_client

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
STAGING_DIR = SQL_DIR / "staging"
MODELS_DIR = SQL_DIR / "models"

log = logging.getLogger("build_models")


def model_files(directory: Path = MODELS_DIR) -> list[Path]:
    """The model scripts, sorted by name; fail if there are none (a wrong path must not pass silently)."""
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no .sql files found in {directory}")
    return files


def sql_files() -> list[Path]:
    """Every script to run: the staging scripts first, then the models."""
    return model_files(STAGING_DIR) + model_files(MODELS_DIR)


def run_model(client: bigquery.Client, path: Path) -> None:
    """Run one script and wait for it; raises if any statement fails."""
    log.info("running %s", path.name)
    client.query(path.read_text(encoding="utf-8")).result()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = build_client()
    for path in sql_files():
        run_model(client, path)


if __name__ == "__main__":
    main()
