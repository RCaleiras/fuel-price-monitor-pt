"""SQL test runner: run every query in sql/tests/ and fail if any returns rows (or cannot run).

Called by .github/workflows/collect.yml as `python -m src.run_sql_tests`, after Build models and before the dashboard
export, so a snapshot that breaks a data rule is never published (the site keeps the previous day).
Locally: `python -m src.run_sql_tests` (needs GCP_PROJECT and BQ_DATASET, like the other scripts).

Every test is a read-only SELECT, so no new permission is needed. Each query has a bytes cap and a timeout; all tests
run even if one fails, so a single run shows every problem. Cost today: ~540 MiB billed per full run (30 tests).
"""

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.cloud import bigquery

from src.collect import build_client

TESTS_DIR = Path(__file__).resolve().parent.parent / "sql" / "tests"
MAX_BYTES_BILLED = 200_000_000  # ~4x the heaviest test today (50 MiB: 5 tables x 10 MiB minimum)
JOB_TIMEOUT_MS = 120_000
MAX_ROWS_SHOWN = 5  # evidence kept for a failing test
EXPECTED_STATEMENT_TYPE = "SELECT"  # a test only reads; anything else (DML, DDL, script) is refused unrun
EXIT_NOT_RUN = 2

log = logging.getLogger("run_sql_tests")


@dataclass(frozen=True)
class TestResult:
    __test__ = False  # not a pytest class

    name: str
    status: str  # "pass" | "fail" | "error"
    n_rows: int
    detail: Any = None  # first rows of a failing test, or the error text


def test_files(directory: Path = TESTS_DIR) -> list[Path]:
    """The test queries, sorted by name; fail if there are none (a wrong path must not pass silently)."""
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no .sql files found in {directory}")
    return files


def _error(path: Path, detail: str) -> TestResult:
    return TestResult(path.stem, "error", 0, detail)


def run_one(client: bigquery.Client, path: Path) -> TestResult:
    """Run one test; anything but a SELECT that returns its complete row set is an error, never a pass."""
    sql = path.read_text(encoding="utf-8")
    if not sql.strip():
        return _error(path, "empty test file")
    config = bigquery.QueryJobConfig(maximum_bytes_billed=MAX_BYTES_BILLED, job_timeout_ms=JOB_TIMEOUT_MS)
    try:
        # A dry run executes nothing and reports what the statement is, so a DELETE or CREATE that landed in
        # sql/tests/ is refused before it can run (it would return no rows, which would otherwise read as a pass).
        statement_type = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True)).statement_type
        if statement_type != EXPECTED_STATEMENT_TYPE:
            return _error(path, f"unexpected statement type {statement_type!r}, expected {EXPECTED_STATEMENT_TYPE!r}; not run")
        result = client.query(sql, job_config=config).result()
        rows = [dict(row.items()) if hasattr(row, "items") else dict(row) for row in result]
        if result.total_rows is not None and result.total_rows != len(rows):
            return _error(path, f"read {len(rows)} rows but BigQuery reports {result.total_rows}")
    except Exception as exc:  # noqa: BLE001 - any failure must be reported per test, not abort the others
        return _error(path, f"{type(exc).__name__}: {exc}")
    if not rows:
        return TestResult(path.stem, "pass", 0)
    return TestResult(path.stem, "fail", len(rows), rows[:MAX_ROWS_SHOWN])


def run_all(client: bigquery.Client, directory: Path = TESTS_DIR) -> list[TestResult]:
    return [run_one(client, path) for path in test_files(directory)]


def main() -> int:
    """Exit 0: every test passed. 1: a test failed or errored. 2: the tests could not be run at all."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()
    try:
        results = run_all(build_client(), TESTS_DIR)
    except Exception:  # noqa: BLE001 - credentials, missing variables, no test files: say that nothing was validated
        log.exception("SQL tests could not be run: nothing was validated, so nothing may be published")
        return EXIT_NOT_RUN
    for r in results:
        if r.status == "pass":
            log.info("PASS  %s", r.name)
        else:
            log.error("%s  %s: %s rows, %s", r.status.upper(), r.name, r.n_rows, r.detail)
    bad = [r for r in results if r.status != "pass"]
    log.info("%d tests, %d passed, %d not passed", len(results), len(results) - len(bad), len(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
