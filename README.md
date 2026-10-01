# Fuel Price Monitor (Portugal)

> Automated price-monitoring pipeline: where and when should a delivery fleet refuel?

_Status: scaffolding. Collection starts as soon as `src/collect.py` is written._

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
_Diagram to add._ Daily GitHub Action -> Python collector -> BigQuery (raw) -> SQL models -> Looker Studio.

## Data model
See `docs/schema.md`.

## Key insights
_To fill after the first weeks of data._

## How to reproduce
1. Copy `config.example.env` to `.env` and fill in your GCP project.
2. `pip install -r requirements.txt`
3. `python -m src.load_history` (one-off), then `python -m src.collect` (daily).

## How I'd deliver this to a client
_Scope, timeline and deliverables for a fleet or retail price-monitoring engagement. To write at the end._

## Demo
_60-90 s video and Looker Studio link to add._
