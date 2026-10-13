from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src import run_sql_tests as rst


def write_tests(tmp_path, **files):
    for name, sql in files.items():
        (tmp_path / f"{name}.sql").write_text(sql, encoding="utf-8")
    return tmp_path


def client_returning(rows_by_sql, statement_types=None, reported_total=None):
    """A fake BigQuery client: each query returns the rows registered for its SQL text.

    A dry run executes nothing and reports the statement type (SELECT unless `statement_types` says otherwise).
    `reported_total` overrides the row count BigQuery reports, to simulate a partial read.
    """
    client = MagicMock()
    statement_types = statement_types or {}
    reported_total = reported_total or {}

    def query(sql, job_config=None):
        job = MagicMock()
        if job_config is not None and job_config.dry_run:
            job.statement_type = statement_types.get(sql, "SELECT")
            return job
        outcome = rows_by_sql[sql]
        if isinstance(outcome, Exception):
            job.result.side_effect = outcome
        else:
            result = MagicMock()
            result.total_rows = reported_total.get(sql, len(outcome))
            result.__iter__.return_value = iter(outcome)
            job.result.return_value = result
        return job

    client.query.side_effect = query
    return client


def executed_queries(client):
    """The calls that really ran (dry runs excluded)."""
    return [c for c in client.query.call_args_list if not c.kwargs["job_config"].dry_run]


def test_test_files_are_the_sql_files_sorted_by_name(tmp_path):
    write_tests(tmp_path, b="SELECT 2", a="SELECT 1")
    (tmp_path / "notes.txt").write_text("ignored")

    assert [p.name for p in rst.test_files(tmp_path)] == ["a.sql", "b.sql"]


def test_test_files_fail_when_there_are_none(tmp_path):
    with pytest.raises(RuntimeError, match="no .sql files"):
        rst.test_files(tmp_path)


def test_a_test_that_returns_no_rows_passes(tmp_path):
    write_tests(tmp_path, ok="SELECT 1 WHERE FALSE")
    client = client_returning({"SELECT 1 WHERE FALSE": []})

    (result,) = rst.run_all(client, tmp_path)

    assert (result.name, result.status, result.n_rows) == ("ok", "pass", 0)


def test_a_test_that_returns_rows_fails_and_keeps_the_first_rows_as_evidence(tmp_path):
    write_tests(tmp_path, bad="SELECT x")
    rows = [{"station_code": i} for i in range(10)]
    client = client_returning({"SELECT x": rows})

    (result,) = rst.run_all(client, tmp_path)

    assert (result.status, result.n_rows) == ("fail", 10)
    assert len(result.detail) == rst.MAX_ROWS_SHOWN
    assert result.detail[0] == {"station_code": 0}


def test_a_query_error_is_reported_as_error_and_the_other_tests_still_run(tmp_path):
    write_tests(tmp_path, a="SELECT 1", b="SELECT 2", c="SELECT 3")
    client = client_returning({"SELECT 1": [], "SELECT 2": RuntimeError("quota exceeded"), "SELECT 3": []})

    results = rst.run_all(client, tmp_path)

    assert [(r.name, r.status) for r in results] == [("a", "pass"), ("b", "error"), ("c", "pass")]
    assert "quota exceeded" in results[1].detail


def test_each_query_carries_the_cost_cap_and_the_timeout(tmp_path):
    write_tests(tmp_path, a="SELECT 1")
    client = client_returning({"SELECT 1": []})

    rst.run_all(client, tmp_path)

    config = client.query.call_args.kwargs["job_config"]
    assert config.maximum_bytes_billed == rst.MAX_BYTES_BILLED
    assert int(config.job_timeout_ms) == rst.JOB_TIMEOUT_MS


def test_the_cost_cap_leaves_room_for_the_heaviest_test_but_is_far_below_the_export_cap():
    # heaviest test today bills 50 MiB (5 tables x 10 MiB minimum)
    assert 52_428_800 < rst.MAX_BYTES_BILLED <= 500_000_000


def test_main_exits_zero_when_everything_passes(monkeypatch, tmp_path):
    write_tests(tmp_path, a="SELECT 1")
    monkeypatch.setattr(rst, "build_client", lambda: client_returning({"SELECT 1": []}))
    monkeypatch.setattr(rst, "TESTS_DIR", tmp_path)

    assert rst.main() == 0


def test_main_exits_non_zero_when_a_test_fails_or_errors(monkeypatch, tmp_path):
    write_tests(tmp_path, a="SELECT 1", b="SELECT 2")
    monkeypatch.setattr(rst, "build_client", lambda: client_returning({"SELECT 1": [], "SELECT 2": [{"x": 1}]}))
    monkeypatch.setattr(rst, "TESTS_DIR", tmp_path)

    assert rst.main() == 1


@pytest.mark.parametrize("statement_type", ["DELETE", "CREATE_TABLE_AS_SELECT", "SCRIPT", None])
def test_a_statement_that_is_not_a_select_is_an_error_and_is_never_executed(tmp_path, statement_type):
    sql = "DELETE FROM t WHERE TRUE"
    write_tests(tmp_path, danger=sql)
    client = client_returning({sql: []}, statement_types={sql: statement_type})

    (result,) = rst.run_all(client, tmp_path)

    assert (result.status, result.n_rows) == ("error", 0)
    assert "unexpected statement type" in result.detail
    assert executed_queries(client) == []


def test_an_empty_test_file_is_an_error_and_nothing_is_sent_to_bigquery(tmp_path):
    write_tests(tmp_path, blank="  \n")
    client = client_returning({})

    (result,) = rst.run_all(client, tmp_path)

    assert (result.status, result.detail) == ("error", "empty test file")
    client.query.assert_not_called()


def test_a_partial_read_is_an_error_not_a_pass(tmp_path):
    write_tests(tmp_path, partial="SELECT x")
    client = client_returning({"SELECT x": []}, reported_total={"SELECT x": 3})

    (result,) = rst.run_all(client, tmp_path)

    assert result.status == "error"
    assert "reports 3" in result.detail


def test_a_dry_run_failure_is_an_error_not_a_pass(tmp_path):
    write_tests(tmp_path, a="SELECT 1")
    client = MagicMock()
    client.query.side_effect = RuntimeError("403 access denied")

    (result,) = rst.run_all(client, tmp_path)

    assert result.status == "error"
    assert "403 access denied" in result.detail


def test_main_exits_two_and_says_nothing_was_validated_when_the_client_cannot_be_built(monkeypatch, tmp_path, caplog):
    write_tests(tmp_path, a="SELECT 1")
    monkeypatch.setattr(rst, "TESTS_DIR", tmp_path)

    def no_credentials():
        raise KeyError("GCP_PROJECT")

    monkeypatch.setattr(rst, "build_client", no_credentials)

    assert rst.main() == rst.EXIT_NOT_RUN == 2
    assert "nothing was validated" in caplog.text


def test_main_exits_two_when_there_are_no_test_files(monkeypatch, tmp_path):
    monkeypatch.setattr(rst, "TESTS_DIR", tmp_path)  # empty directory
    monkeypatch.setattr(rst, "build_client", lambda: client_returning({}))

    assert rst.main() == 2


WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "collect.yml"


def workflow_step(text, name):
    """The text of one step of the workflow, from its `- name:` line to the next step."""
    start = text.index(f"- name: {name}")
    end = text.find("\n      - ", start + 1)
    return text[start : end if end != -1 else len(text)]


def test_the_workflow_runs_sql_tests_before_anything_is_published():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert text.index("- name: Build models") < text.index("- name: Run SQL tests")
    assert text.index("- name: Run SQL tests") < text.index("- name: Export dashboard")
    assert text.index("- name: Export dashboard") < text.index("- name: Upload site")
    assert "python -m src.run_sql_tests" in workflow_step(text, "Run SQL tests")


def test_a_failing_sql_test_blocks_the_workflow_instead_of_warning():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "continue-on-error" not in text
    for name in ("Run SQL tests", "Export dashboard", "Upload site"):
        step = workflow_step(text, name)
        assert "always()" not in step and "failure()" not in step, name
    assert "if:" not in workflow_step(text, "Run SQL tests")  # the step can never be skipped
    # deploy waits for the whole collect job, so a red job leaves the site on the last snapshot
    assert "needs: collect" in text.split("  deploy:")[1]


def test_the_real_tests_directory_is_found_and_not_empty():
    names = [p.name for p in rst.test_files()]

    assert len(names) >= 30
    assert "dashboard_station_prices_match_fact.sql" in names


def window_values(client):
    """The window_days parameter of every query sent (dry runs included), None where the query had none."""
    values = []
    for call in client.query.call_args_list:
        params = call.kwargs["job_config"].query_parameters
        values.append(params[0].value if params else None)
    return values


def test_a_test_that_uses_the_window_gets_the_export_default_in_the_dry_run_and_the_real_run(tmp_path):
    sql = "SELECT 1 WHERE @window_days < 0"
    write_tests(tmp_path, windowed=sql)
    client = client_returning({sql: []})

    rst.run_all(client, tmp_path)

    assert window_values(client) == [rst.DEFAULT_WINDOW_DAYS, rst.DEFAULT_WINDOW_DAYS]


def test_the_window_can_be_overridden_so_the_test_follows_a_non_default_export(tmp_path):
    sql = "SELECT 1 WHERE @window_days < 0"
    write_tests(tmp_path, windowed=sql)
    client = client_returning({sql: []})

    rst.run_all(client, tmp_path, window_days=30)

    assert window_values(client) == [30, 30]


def test_a_test_without_the_window_is_sent_no_parameter(tmp_path):
    write_tests(tmp_path, plain="SELECT 1")
    client = client_returning({"SELECT 1": []})

    rst.run_all(client, tmp_path)

    assert window_values(client) == [None, None]


def test_the_export_default_window_is_the_one_the_dashboard_tests_use():
    from src import export_dashboard

    assert rst.DEFAULT_WINDOW_DAYS == export_dashboard.DEFAULT_WINDOW_DAYS
    for name in ("dashboard_station_prices_match_fact.sql", "dashboard_stations_unique.sql"):
        sql = (rst.TESTS_DIR / name).read_text(encoding="utf-8")
        assert "@window_days" in sql
        assert "INTERVAL 89 DAY" not in sql  # no second copy of the window length


def test_a_test_that_outlives_the_budget_is_an_error_and_the_fast_ones_still_report(tmp_path):
    import threading

    write_tests(tmp_path, fast="SELECT 1", slow="SELECT 2")
    release = threading.Event()
    client = client_returning({"SELECT 1": [], "SELECT 2": []})
    original = client.query.side_effect

    def query(sql, job_config=None):
        if sql == "SELECT 2":
            release.wait(timeout=5)  # stands in for a BigQuery job that does not come back
        return original(sql, job_config=job_config)

    client.query.side_effect = query
    try:
        results = rst.run_all(client, tmp_path, budget_s=0.2)
    finally:
        release.set()

    assert [(r.name, r.status) for r in results] == [("fast", "pass"), ("slow", "error")]
    assert "budget" in results[1].detail


def test_results_keep_name_order_when_the_tests_run_in_parallel(tmp_path):
    names = [f"t{i:02d}" for i in range(20)]
    write_tests(tmp_path, **{n: f"SELECT '{n}'" for n in names})
    client = client_returning({f"SELECT '{n}'": [] for n in names})

    results = rst.run_all(client, tmp_path)

    assert [r.name for r in results] == names


def test_the_sql_test_step_has_a_time_limit_above_the_runner_budget():
    import re

    step = workflow_step(WORKFLOW.read_text(encoding="utf-8"), "Run SQL tests")
    minutes = int(re.search(r"timeout-minutes:\s*(\d+)", step).group(1))

    assert minutes * 60 > rst.TOTAL_BUDGET_S
