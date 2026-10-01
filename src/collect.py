"""Daily collector: DGEG station prices -> BigQuery raw table.

Called by .github/workflows/collect.yml as `python -m src.collect`.
Rules are in docs/sources.md; table layout is in docs/schema.md.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from google.cloud import bigquery
from google.oauth2 import service_account

BASE_URL = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb"
FUEL_TYPES_URL = f"{BASE_URL}/GetTiposCombustiveis"
API_URL = f"{BASE_URL}/PesquisarPostos"
USER_AGENT = "fuel-monitor-portfolio"  # no personal data here
REQUEST_TIMEOUT_S = 60
PAGE_SIZE = 5000  # larger than any fuel's station count: one request per fuel
MAX_PAGES = 10  # safety net against a paging loop if the API ignores `pagina`

STATIONS_TABLE = "raw_station_prices"
FUEL_TYPES_TABLE = "raw_fuel_types"

STATION_SCHEMA = [
    bigquery.SchemaField("Id", "INTEGER"),
    bigquery.SchemaField("Nome", "STRING"),
    bigquery.SchemaField("TipoPosto", "STRING"),
    bigquery.SchemaField("Marca", "STRING"),
    bigquery.SchemaField("Combustivel", "STRING"),
    bigquery.SchemaField("Preco", "STRING"),
    bigquery.SchemaField("DataAtualizacao", "STRING"),
    bigquery.SchemaField("Distrito", "STRING"),
    bigquery.SchemaField("Municipio", "STRING"),
    bigquery.SchemaField("Localidade", "STRING"),
    bigquery.SchemaField("Morada", "STRING"),
    bigquery.SchemaField("CodPostal", "STRING"),
    bigquery.SchemaField("Latitude", "FLOAT"),
    bigquery.SchemaField("Longitude", "FLOAT"),
    bigquery.SchemaField("Quantidade", "INTEGER"),
    bigquery.SchemaField("fuel_id", "INTEGER"),
    bigquery.SchemaField("collected_at", "TIMESTAMP"),
]
FUEL_TYPE_SCHEMA = [
    bigquery.SchemaField("Id", "INTEGER"),
    bigquery.SchemaField("Descritivo", "STRING"),
    bigquery.SchemaField("UnidadeMedida", "STRING"),
    bigquery.SchemaField("fl_ativo", "BOOLEAN"),
    bigquery.SchemaField("fl_rodoviario", "BOOLEAN"),
    bigquery.SchemaField("fl_ViewWebSite", "BOOLEAN"),
    bigquery.SchemaField("collected_at", "TIMESTAMP"),
]

log = logging.getLogger("collect")


def get_json(session: requests.Session, url: str, params: dict[str, Any] | None = None) -> list[dict]:
    """GET an API endpoint and return `resultado`; raise if the HTTP call or `status` fails."""
    response = session.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    body = response.json()
    if not body.get("status"):
        raise RuntimeError(f"DGEG API returned status=false for {url}: {body.get('mensagem')!r}")
    return body.get("resultado") or []


def fetch_fuel_types(session: requests.Session) -> list[dict]:
    """All fuel types as the API describes them (active / road flags included)."""
    fuel_types = get_json(session, FUEL_TYPES_URL)
    if not fuel_types:
        raise RuntimeError("DGEG returned an empty fuel type list")
    return fuel_types


def fetch_station_rows(session: requests.Session, fuel_id: int) -> list[dict]:
    """Every station row for one fuel, verified against the API's own total (`Quantidade`)."""
    rows: list[dict] = []
    expected: int | None = None
    for page in range(1, MAX_PAGES + 1):
        batch = get_json(
            session,
            API_URL,
            params={
                "idsTiposComb": fuel_id,
                "idMarca": "",
                "idTipoPosto": "",
                "idDistrito": "",
                "idsMunicipios": "",
                "qtdPorPagina": PAGE_SIZE,
                "pagina": page,
            },
        )
        if not batch:
            break
        rows.extend(batch)
        expected = batch[0]["Quantidade"]
        if len(rows) >= expected:
            break
    if expected is None:
        raise RuntimeError(f"fuel_id={fuel_id}: API returned no stations")
    if len(rows) != expected:
        raise RuntimeError(f"fuel_id={fuel_id}: collected {len(rows)} rows but API Quantidade={expected}")
    return rows


def with_metadata(row: dict, collected_at: str, **extra: Any) -> dict:
    """Copy of the raw API row plus our added columns; the API fields stay untouched."""
    return {**row, **extra, "collected_at": collected_at}


def build_client() -> bigquery.Client:
    """Service-account key from GCP_SA_KEY (GitHub Actions) or application default credentials."""
    project = os.environ["GCP_PROJECT"]
    key = os.environ.get("GCP_SA_KEY")
    if key:
        credentials = service_account.Credentials.from_service_account_info(
            json.loads(key), scopes=["https://www.googleapis.com/auth/bigquery"]
        )
        return bigquery.Client(project=project, credentials=credentials)
    return bigquery.Client(project=project)


def append_rows(client: bigquery.Client, table: str, schema: list[bigquery.SchemaField], rows: list[dict]) -> None:
    """Append-only load job (never truncates); waits for completion and raises on failure."""
    table_id = f"{client.project}.{os.environ['BQ_DATASET']}.{table}"
    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        create_disposition=bigquery.CreateDisposition.CREATE_IF_NEEDED,
        ignore_unknown_values=False,
    )
    client.load_table_from_json(rows, table_id, job_config=job_config).result()
    log.info("loaded %d rows into %s", len(rows), table_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv()
    collected_at = datetime.now(timezone.utc).isoformat()

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    fuel_types = fetch_fuel_types(session)
    targets = [f for f in fuel_types if f["fl_ativo"] and f["fl_rodoviario"]]
    log.info("collecting %d of %d fuel types", len(targets), len(fuel_types))

    # Fetch everything first: if any fuel fails or its count mismatches, nothing is loaded,
    # so a run never leaves a partial snapshot in the raw table.
    station_rows: list[dict] = []
    for fuel in targets:
        rows = fetch_station_rows(session, fuel["Id"])
        log.info("fuel %s (%s): %d rows", fuel["Id"], fuel["Descritivo"], len(rows))
        station_rows.extend(with_metadata(r, collected_at, fuel_id=fuel["Id"]) for r in rows)

    fuel_type_rows = [
        with_metadata({field.name: f.get(field.name) for field in FUEL_TYPE_SCHEMA[:-1]}, collected_at)
        for f in fuel_types
    ]

    client = build_client()
    append_rows(client, STATIONS_TABLE, STATION_SCHEMA, station_rows)
    append_rows(client, FUEL_TYPES_TABLE, FUEL_TYPE_SCHEMA, fuel_type_rows)


if __name__ == "__main__":
    main()
