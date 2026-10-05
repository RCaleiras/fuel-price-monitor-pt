from unittest.mock import MagicMock

import pytest

from src import build_models


def test_model_files_returns_sql_files_sorted_by_name(tmp_path):
    (tmp_path / "b.sql").write_text("SELECT 2")
    (tmp_path / "a.sql").write_text("SELECT 1")
    (tmp_path / "notes.txt").write_text("ignored")

    assert [p.name for p in build_models.model_files(tmp_path)] == ["a.sql", "b.sql"]


def test_model_files_fails_when_there_are_no_sql_files(tmp_path):
    with pytest.raises(RuntimeError, match="no .sql files"):
        build_models.model_files(tmp_path)


def test_run_model_sends_the_whole_script_and_waits(tmp_path):
    path = tmp_path / "dim.sql"
    path.write_text("SELECT 'Gasóleo';\nSELECT 2;", encoding="utf-8")
    client = MagicMock()

    build_models.run_model(client, path)

    client.query.assert_called_once_with("SELECT 'Gasóleo';\nSELECT 2;")
    client.query.return_value.result.assert_called_once()


def test_run_model_propagates_query_failures(tmp_path):
    path = tmp_path / "dim.sql"
    path.write_text("SELECT 1")
    client = MagicMock()
    client.query.return_value.result.side_effect = RuntimeError("bad sql")

    with pytest.raises(RuntimeError, match="bad sql"):
        build_models.run_model(client, path)


def test_main_runs_every_model_in_order(monkeypatch, tmp_path):
    (tmp_path / "b.sql").write_text("SELECT 2")
    (tmp_path / "a.sql").write_text("SELECT 1")
    client = MagicMock()
    monkeypatch.setattr(build_models, "build_client", lambda: client)
    monkeypatch.setattr(build_models, "model_files", lambda: sorted(tmp_path.glob("*.sql")))

    build_models.main()

    assert [c.args[0] for c in client.query.call_args_list] == ["SELECT 1", "SELECT 2"]


def test_real_models_run_dimensions_before_facts_and_reports():
    names = [p.name for p in build_models.model_files()]

    last_dimension = max(i for i, n in enumerate(names) if n.startswith("dim_"))
    first_dependent = min(i for i, n in enumerate(names) if n.startswith(("fct_", "rpt_")))

    assert last_dimension < first_dependent
