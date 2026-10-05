# Fuel Price Monitor (Portugal)

> Automated price-monitoring pipeline: where and when should a delivery fleet refuel?

_Status: in progress. Station prices have been collected daily since 2026-10-01; the staging view and the two
dimensions are live. The fact table and the Looker Studio dashboard are next._

## Business question
How much can a 20-vehicle fleet save by choosing where and when to refuel, by district?
(Quantified in EUR per vehicle per year. To be filled once data accumulates.)

## Sources and licences
| Source | What | Licence / status |
|---|---|---|
| DGEG fuel price portal API | Daily price per station and fuel type | Station dataset is CC BY 4.0 on dados.gov.pt; API endpoint has no written terms (see `docs/sources.md`) |
| DGEG weekly Excel (2004-today) | National weekly average price, split into pre-tax, tax and VAT | No licence stated (see `docs/sources.md`) |

Data source: Direcao-Geral de Energia e Geologia (DGEG).

## Architecture
_Diagram to add._ Daily GitHub Action -> Python collector -> BigQuery `raw_station_prices` (append only) ->
`stg_station_prices` (daily series view) -> dimensions `dim_fuel_type` and `dim_stations` -> fact table -> Looker Studio.

- `collect-fuel-prices` (06:01 UTC): collects the day's snapshot, then updates the dimensions.
- `check-freshness` (20:30 UTC): fails and sends an email if today's data is missing.

## Data model
- Raw tables keep the source as it comes; cleaning happens in SQL views (`sql/staging/`).
- Dimensions (`sql/models/`) use surrogate keys that never change, plus an "Unknown" row (key -1) so facts hold no NULL.
- Known limit: a station's name, brand and address are overwritten when DGEG changes them (no history), so a past
  price shows the station's current attributes.

Details, decisions and open questions in `docs/schema.md`; sources and data quality findings in `docs/sources.md`.

## Key insights
_To fill after the first weeks of data._

## How to reproduce
1. Copy `config.example.env` to `.env` and fill in your GCP project.
2. `pip install -r requirements.txt`
3. `python -m src.load_history` (one-off), then `python -m src.collect` (daily).
4. Create the staging view: run `sql/staging/stg_station_prices.sql` in BigQuery.
5. `python -m src.build_models` (daily, after the collector) creates and updates the dimensions in `sql/models/`.
6. Tests: `python -m pytest --cov=src -q` for the Python code; each file in `sql/tests/` is a query that must return 0 rows.

## How I'd deliver this to a client
_Scope, timeline and deliverables for a fleet or retail price-monitoring engagement. To write at the end._

## Demo
_60-90 s video and Looker Studio link to add._
