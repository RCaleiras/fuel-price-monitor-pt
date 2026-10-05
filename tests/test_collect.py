import json
from unittest.mock import MagicMock

import pytest
import requests
from google.cloud import bigquery

from src import collect


def api_response(resultado=None, status=True, mensagem=None) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {"status": status, "mensagem": mensagem, "resultado": resultado}
    return response


def station(station_id: int, total: int) -> dict:
    return {"Id": station_id, "Nome": f"Posto {station_id}", "Quantidade": total}


def fuel(fuel_id: int, name: str, active: bool = True, road: bool = True) -> dict:
    return {
        "Id": fuel_id,
        "Descritivo": name,
        "UnidadeMedida": "Euro/litro",
        "fl_ativo": active,
        "fl_rodoviario": road,
        "fl_ViewWebSite": True,
        "campo_novo_da_api": "ignored",
    }


def session_returning(*responses: MagicMock) -> MagicMock:
    session = MagicMock(spec=requests.Session)
    session.get.side_effect = list(responses)
    return session


# --- get_json -----------------------------------------------------------------------------


def test_get_json_returns_the_resultado_list():
    session = session_returning(api_response([{"Id": 1}]))

    assert collect.get_json(session, "http://x") == [{"Id": 1}]


def test_get_json_sends_params_and_timeout():
    session = session_returning(api_response([]))

    collect.get_json(session, "http://x", params={"a": 1})

    session.get.assert_called_once_with("http://x", params={"a": 1}, timeout=collect.REQUEST_TIMEOUT_S)


def test_get_json_returns_empty_list_when_resultado_is_null():
    session = session_returning(api_response(None))

    assert collect.get_json(session, "http://x") == []


def test_get_json_raises_when_status_is_false():
    session = session_returning(api_response(status=False, mensagem="boom"))

    with pytest.raises(RuntimeError, match="boom"):
        collect.get_json(session, "http://x")


def test_get_json_propagates_http_errors():
    response = api_response([])
    response.raise_for_status.side_effect = requests.HTTPError("500")
    session = session_returning(response)

    with pytest.raises(requests.HTTPError):
        collect.get_json(session, "http://x")


# --- fetch_fuel_types ---------------------------------------------------------------------


def test_fetch_fuel_types_returns_the_api_list():
    session = session_returning(api_response([fuel(1, "Gasóleo simples")]))

    assert collect.fetch_fuel_types(session) == [fuel(1, "Gasóleo simples")]


def test_fetch_fuel_types_raises_on_empty_list():
    session = session_returning(api_response([]))

    with pytest.raises(RuntimeError, match="empty fuel type list"):
        collect.fetch_fuel_types(session)


# --- fetch_station_rows -------------------------------------------------------------------


def test_fetch_station_rows_single_page():
    rows = [station(1, 2), station(2, 2)]
    session = session_returning(api_response(rows))

    assert collect.fetch_station_rows(session, 3201) == rows
    assert session.get.call_count == 1
    params = session.get.call_args.kwargs["params"]
    assert params["idsTiposComb"] == 3201
    assert params["pagina"] == 1
    assert params["qtdPorPagina"] == collect.PAGE_SIZE


def test_fetch_station_rows_follows_pages_until_total_is_reached():
    page_1 = [station(1, 3), station(2, 3)]
    page_2 = [station(3, 3)]
    session = session_returning(api_response(page_1), api_response(page_2))

    rows = collect.fetch_station_rows(session, 3201)

    assert rows == page_1 + page_2
    assert [c.kwargs["params"]["pagina"] for c in session.get.call_args_list] == [1, 2]


def test_fetch_station_rows_raises_when_api_returns_no_stations():
    session = session_returning(api_response([]))

    with pytest.raises(RuntimeError, match="no stations"):
        collect.fetch_station_rows(session, 3201)


def test_fetch_station_rows_raises_when_count_does_not_match_quantidade():
    session = session_returning(api_response([station(1, 5)]), api_response([]))

    with pytest.raises(RuntimeError, match="collected 1 rows but API Quantidade=5"):
        collect.fetch_station_rows(session, 3201)


def test_fetch_station_rows_stops_at_max_pages(monkeypatch):
    monkeypatch.setattr(collect, "MAX_PAGES", 2)
    session = session_returning(*(api_response([station(i, 99)]) for i in range(5)))

    with pytest.raises(RuntimeError, match="Quantidade=99"):
        collect.fetch_station_rows(session, 3201)
    assert session.get.call_count == 2


# --- with_metadata ------------------------------------------------------------------------


def test_with_metadata_adds_columns_without_mutating_the_row():
    row = {"Id": 1}

    result = collect.with_metadata(row, "2026-01-01T06:01:00+00:00", fuel_id=7)

    assert result == {"Id": 1, "fuel_id": 7, "collected_at": "2026-01-01T06:01:00+00:00"}
    assert row == {"Id": 1}


# --- build_client -------------------------------------------------------------------------


def test_build_client_uses_service_account_key_when_present(monkeypatch):
    monkeypatch.setenv("GCP_PROJECT", "proj")
    monkeypatch.setenv("GCP_SA_KEY", json.dumps({"type": "service_account"}))
    from_info = MagicMock(return_value="creds")
    client_cls = MagicMock()
    monkeypatch.setattr(collect.service_account.Credentials, "from_service_account_info", from_info)
    monkeypatch.setattr(collect.bigquery, "Client", client_cls)

    collect.build_client()

    assert from_info.call_args.args[0] == {"type": "service_account"}
    client_cls.assert_called_once_with(project="proj", credentials="creds")


def test_build_client_falls_back_to_application_default_credentials(monkeypatch):
    monkeypatch.setenv("GCP_PROJECT", "proj")
    monkeypatch.delenv("GCP_SA_KEY", raising=False)
    client_cls = MagicMock()
    monkeypatch.setattr(collect.bigquery, "Client", client_cls)

    collect.build_client()

    client_cls.assert_called_once_with(project="proj")


def test_build_client_fails_without_project(monkeypatch):
    monkeypatch.delenv("GCP_PROJECT", raising=False)

    with pytest.raises(KeyError):
        collect.build_client()


# --- append_rows --------------------------------------------------------------------------


def test_append_rows_runs_an_append_only_load_job(monkeypatch):
    monkeypatch.setenv("BQ_DATASET", "ds")
    client = MagicMock()
    client.project = "proj"
    rows = [{"Id": 1}]

    collect.append_rows(client, "tbl", collect.STATION_SCHEMA, rows)

    args, kwargs = client.load_table_from_json.call_args
    assert args == (rows, "proj.ds.tbl")
    config = kwargs["job_config"]
    assert config.write_disposition == bigquery.WriteDisposition.WRITE_APPEND
    assert config.create_disposition == bigquery.CreateDisposition.CREATE_IF_NEEDED
    assert config.ignore_unknown_values is False
    client.load_table_from_json.return_value.result.assert_called_once()


def test_append_rows_propagates_load_job_failures(monkeypatch):
    monkeypatch.setenv("BQ_DATASET", "ds")
    client = MagicMock()
    client.project = "proj"
    client.load_table_from_json.return_value.result.side_effect = RuntimeError("load failed")

    with pytest.raises(RuntimeError, match="load failed"):
        collect.append_rows(client, "tbl", collect.STATION_SCHEMA, [])


# --- main ---------------------------------------------------------------------------------


@pytest.fixture
def pipeline(monkeypatch):
    """Patch the network and BigQuery edges; return the fake session and client."""
    session = MagicMock(spec=requests.Session)
    session.headers = {}
    client = MagicMock()
    monkeypatch.setattr(collect.requests, "Session", lambda: session)
    monkeypatch.setattr(collect, "load_dotenv", lambda: None)
    monkeypatch.setattr(collect, "build_client", lambda: client)
    monkeypatch.setattr(collect, "append_rows", MagicMock())
    return session, client


def test_main_loads_only_active_road_fuels(pipeline, monkeypatch):
    session, client = pipeline
    fuels = [fuel(1, "Gasóleo simples"), fuel(2, "Inativo", active=False), fuel(3, "Naval", road=False)]
    monkeypatch.setattr(collect, "fetch_fuel_types", lambda s: fuels)
    fetched = []

    def fake_fetch(s, fuel_id):
        fetched.append(fuel_id)
        return [station(10, 1)]

    monkeypatch.setattr(collect, "fetch_station_rows", fake_fetch)

    collect.main()

    assert fetched == [1]
    assert session.headers["User-Agent"] == collect.USER_AGENT
    (stations_call,) = collect.append_rows.call_args_list
    assert stations_call.args[:3] == (client, collect.STATIONS_TABLE, collect.STATION_SCHEMA)
    station_rows = stations_call.args[3]
    assert len(station_rows) == 1
    assert station_rows[0]["fuel_id"] == 1
    assert station_rows[0]["Id"] == 10


def test_main_uses_one_collected_at_for_every_row(pipeline, monkeypatch):
    monkeypatch.setattr(collect, "fetch_fuel_types", lambda s: [fuel(1, "A"), fuel(2, "B")])
    monkeypatch.setattr(collect, "fetch_station_rows", lambda s, fuel_id: [station(fuel_id, 1)])

    collect.main()

    (stations_call,) = collect.append_rows.call_args_list
    stamps = {r["collected_at"] for r in stations_call.args[3]}
    assert len(stamps) == 1


def test_main_loads_nothing_when_a_fuel_fails(pipeline, monkeypatch):
    monkeypatch.setattr(collect, "fetch_fuel_types", lambda s: [fuel(1, "A"), fuel(2, "B")])

    def fake_fetch(s, fuel_id):
        if fuel_id == 2:
            raise RuntimeError("count mismatch")
        return [station(1, 1)]

    monkeypatch.setattr(collect, "fetch_station_rows", fake_fetch)

    with pytest.raises(RuntimeError, match="count mismatch"):
        collect.main()

    collect.append_rows.assert_not_called()
