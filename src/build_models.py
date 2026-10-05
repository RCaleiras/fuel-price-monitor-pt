"""Model builder: run the SQL files in sql/models/ against BigQuery, in file-name order.

Called by .github/workflows/collect.yml as `python -m src.build_models`, right after the collector.
Each file is a script that only adds what is missing, so running it twice changes nothing.
"""

import logging
from pathlib import Path

from google.cloud import bigquery

from src.collect import build_client

MODELS_DIR = Path(__file__).resolve().parent.parent / "sql" / "models"

log = logging.getLogger("build_models")


def model_files(directory: Path = MODELS_DIR) -> list[Path]:
    """The model scripts, sorted by name; fail if there are none (a wrong path must not pass silently)."""
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no .sql files found in {directory}")
    return files


def run_model(client: bigquery.Client, path: Path) -> None:
    """Run one script and wait for it; raises if any statement fails."""
    log.info("running %s", path.name)
    client.query(path.read_text(encoding="utf-8")).result()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = build_client()
    for path in model_files():
        run_model(client, path)


if __name__ == "__main__":
    main()
