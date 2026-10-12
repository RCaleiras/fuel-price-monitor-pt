# Fuel Price Monitor (Portugal)

> Automated price-monitoring pipeline: where and when should a delivery fleet refuel?

_Status: in progress. Station prices have been collected daily since 2026-10-01; the models and a public,
interactive dashboard (GitHub Pages, refreshed by the daily run) are built. Savings analysis is next._

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
`stg_station_prices` (daily series table) -> dimensions `dim_date`, `dim_fuel_type`, `dim_location`, `dim_stations` ->
fact `fct_station_price_daily` -> report view `rpt_station_price_daily` -> daily JSON export -> static dashboard on
GitHub Pages.

- `collect-fuel-prices` (06:01 UTC): collects the day's snapshot, updates the models, exports the dashboard data and
  deploys the site.
- `check-freshness` (20:30 UTC): fails and sends an email if today's data is missing.

## Data model
- Raw tables keep the source as it comes; cleaning happens in SQL views (`sql/staging/`).
- Dimensions (`sql/models/`) use surrogate keys that never change, plus an "Unknown" row (key -1) so facts hold no NULL.
- The daily fact keeps every price, including prices carried over for stations DGEG stopped publishing, flagged so the
  dashboard can filter them.
- Known limit: a station's name, brand and address are overwritten when DGEG changes them (no history), so a past
  price shows the station's current attributes.
- Places (district > municipality > locality) live in `dim_location`, so the dashboard can drill down over the whole
  country. DGEG spells the same place in several ways (`Faro` / `FARO`); they are merged, and the name shown is the
  one that is not all capitals. A place DGEG only ever sends in capitals stays in capitals. A station with no locality
  shows the locality "Unknown" inside its municipality.

Details, decisions and open questions in `docs/schema.md`; sources and data quality findings in `docs/sources.md`.

## Dashboard
Public, interactive and free to run: a static site (`site/`) on GitHub Pages that reads one JSON file exported every
day from BigQuery by `src/export_dashboard.py`. In English; filters by fuel, district, municipality, brand and station
type; a price board with the 7-day change; daily evolution with fuel comparison and a click-to-inspect historical day;
comparison by region, brand or station type; linked station map and table with a station detail drawer; biggest price
changes. The whole selection lives in the URL, so views can be shared. The browser never touches BigQuery. Definitions, data flow, setup and limits: `docs/dashboard.md`.

## Key insights
_To fill after the first weeks of data._

## How to reproduce
1. Copy `config.example.env` to `.env` and fill in your GCP project.
2. `pip install -r requirements.txt`
3. `python -m src.load_history` (one-off), then `python -m src.collect` (daily).
4. `python -m src.build_models` (daily, after the collector) rebuilds the staging table in `sql/staging/`, then creates
   and updates the dimensions, the fact and the report view in `sql/models/`.
5. `python -m src.export_dashboard --out site/data` writes the dashboard data (up to 90 days per station); `python -m http.server -d site` serves it.
6. Tests: `python -m pytest --cov=src -q` for the Python code; `node --test "tests/js/*.test.mjs"` for the dashboard
   logic; each file in `sql/tests/` is a query that must return 0 rows (`python -m src.run_sql_tests` runs them all, and the
   workflow runs it before the export).

## How I'd deliver this to a client
_Scope, timeline and deliverables for a fleet or retail price-monitoring engagement. To write at the end._

## Demo
_Live link: https://rcaleiras.github.io/fuel-price-monitor-pt/ (once Pages is enabled, see `docs/dashboard.md`).
60-90 s video to add._
