# Schema (draft v2, updated after the 2026-10-01 sample)

Based on one full-day sample (14,018 rows, 3,175 stations, 12 road fuels). Numbers below come from that sample.

## Layers
| Layer | Table | Grain | Source |
|---|---|---|---|
| raw | `raw_station_prices` | collection run x station x fuel (append only) | DGEG portal API |
| raw | `raw_weekly_national` | week (Monday) x fuel x component | DGEG Excel, pivot cache (50,736 records) |
| raw | `raw_history_2004_2009` | week x fuel (retail price only) | DGEG Excel, sheet "Precos (2004 a 2009)" |
| raw | `raw_tax_events` | legislative change | DGEG Excel, sheet "Legislacao" |
| model | `dim_stations` | station | table fed from `stg_station_prices` by `src/build_models.py` |
| model | `dim_fuel_type` | fuel type | table fed from `stg_station_prices` by `src/build_models.py` |
| staging | `stg_station_prices` (view) | station x fuel x day | daily series built from raw, see "Daily grain" below |
| model | `fact_price_weekly_national` | week x fuel x component | cleaned raw_weekly_national |

## raw_station_prices (store the API fields as they come)
`Id, Nome, TipoPosto, Marca, Combustivel, Preco, DataAtualizacao, Distrito, Municipio, Localidade, Morada, CodPostal, Latitude, Longitude, Quantidade` + `fuel_id` (we add it) + `collected_at` (UTC, we add it).
Keep `Preco` and `DataAtualizacao` as text here. Parse in SQL, not in Python.

## Parsing rules (done in SQL staging)
- `Preco`: text like `"2,207 €"` -> `price_eur` NUMERIC (strip the euro sign, comma to dot).
- `DataAtualizacao`: text `"2026-09-25 17:55"` -> TIMESTAMP (`price_updated_at`). Zero bad dates in the sample.
- Fuel units differ: litres, kg and m3. `unit` is read from the fuel name in `stg_station_prices` (names ending in
  `/kg` or `/m3`, otherwise litres); never average across units.
- Fuel name, unit and `is_fleet_fuel` are decided once, in `stg_station_prices`. There is no raw fuel type table: the
  API fuel list is only used by the collector to choose which fuels to collect, and `dim_fuel_type` lists them.

## Dimension keys (dim_fuel_type, dim_stations)
Both dimensions follow the same rules; a new dimension should too.
- The surrogate key (`fuel_sk`, `station_sk`) is a plain counter (1, 2, 3...). The `*_code` column is the DGEG id,
  kept for lookups only.
- The dimension is a table that only grows. A row that already exists keeps its key forever; a new fuel or station
  gets the next number (MAX + 1). Nothing is rebuilt. Descriptive columns (name, unit, brand, address...) are
  overwritten if they change (latest wins, no history).
- Key `-1` is the "Unknown" row. Facts join on the `*_code` and use `COALESCE(d.fuel_sk, -1)` (same for stations), so
  a missing member becomes -1 and facts never hold NULL.
- `dim_stations` keeps stations DGEG stopped publishing, with their last known attributes.
- `src/build_models.py` runs `sql/models/*.sql` after each collection (workflow step "Build models").

## Why snapshot + deduplicate
Only 21% of prices changed in the last 24h (97% in 7 days, 99.9% in 30 days).
So 79% of a daily snapshot repeats yesterday.
- Raw keeps the full daily snapshot: simple, resilient, and it lets us study when stations change price.
- Volume is small: ~14k rows/day, ~5M rows/year, a few hundred MB/year with a compact raw table.
- `stg_station_prices` keeps one row per station x fuel x day (see below).

## Daily grain (stg_station_prices)
One row per station x fuel x day, from the first day we collected that pair to the latest collection day, so any
time analysis can read the price of any day directly.
- Days are UTC collection days (`DATE(collected_at)`). A day with several runs keeps the latest run.
- A day with no run for a pair keeps the previous price and has `observed_that_day = FALSE`. This covers a missed
  collection and a station that is missing from one run and comes back.
- A station that stops appearing in the API is kept with its last known price, flagged `observed_that_day = FALSE`.
  We cannot tell whether it closed: in the first 3 days, every disappearance was a whole station whose price had
  not been updated for about 9 days (see `sources.md`), which looks like DGEG hiding stale prices rather than a closure.
  `days_since_last_observed` says how long ago we last saw it (0 on observed days). There is no cut-off in the view:
  closed stations stay forever, so filter on this column in analyses.
- `days_since_price_update` is the age of the price (day minus the UTC date of `price_updated_at`), NULL if that
  timestamp could not be parsed.
- For "published prices only" use `observed_that_day`; for the full market including carried prices, use all rows.
- `previous_price_eur` is the price of the day before. `is_price_change` is TRUE only when the price differs from it,
  and NULL on a pair's first day. In the first 3 days, about 75% of the `DataAtualizacao` changes kept the same price
  (stations re-submit it with a new timestamp), so `price_updated_at` is not a reliable "price changed" signal.
- `price_updated_at` stays as information only (DGEG local time, no zone, read as Europe/Lisbon).
- History starts when collection started: before that, only `raw_weekly_national` exists (national weekly averages).

## Collector completeness check
For each fuel, the API field `Quantidade` is the total station count.
In the sample, rows collected == `Quantidade` for all fuels.
The collector must check this every run and fail loudly if it does not match.

## Scope decisions from the sample
- Collect fuels where `fl_ativo` and `fl_rodoviario` are true (read from the API, no hard-coded IDs).
- Exclude "Gasoleo colorido" (agricultural use) from the fleet analysis. Keep it in raw.
  Sample showed 6 prices below 1.5 EUR (min 1.000): possible typos.
- Fleet analysis fuels: gasoleo simples/especial, gasolina 95/98, GPL Auto.
- Do not average across fuels with different units (GNC/GNL).

## Known data issues (to handle in staging)
- `Localidade` null in 103 rows, `CodPostal` null in 10.
- Brand "Generico" is 8% of rows: limits brand comparisons.
- `raw_weekly_national` is loaded as-is from the pivot cache and contains 132 duplicate (week, fuel, component) keys:
  the weeks 2019-12-02 and 2020-07-27 appear twice in the source. 126 pairs are identical; the 6 that differ are all
  fuel "Fuel" (2020-07-27 has a 0.0 PVP in the second copy). Deduplicate in staging; the loader does not.
- `raw_history_2004_2009` drops the "Media Anual" rows; the row "2009-06-08 (*)" has a footnote mark and is kept.
- Both tables are rebuilt (WRITE_TRUNCATE) on each `python -m src.load_history` run; `--dry-run` parses only.
- Station attributes (name, brand, address) can change: decide whether `dim_stations` is overwritten or versioned. Default: overwrite, note the limit in the README.

## Reconciliation with DGEG official data
Compare our mean price per fuel with the DGEG official weekly PVP.
Sample result: our simple mean was ~2-3% above the official value
(gasoleo simples 2.246 vs 2.186; gasolina simples 95 2.147 vs 2.099).
Expected causes: DGEG weights by quantities sold, and the dates differ (our run 2026-10-01, official 2026-09-28).
Document this as a methodological note, and compare same-week data once enough history exists.

## Business question (refined)
In the sample, the diesel (gasoleo simples) price spread between stations is 0.51 EUR/l.
The average by district varies little (Aveiro 2.229 to Braganca 2.264).
So the saving is mostly from choosing the station, not the district.
Refined question: how much does a 20-vehicle fleet save per year by choosing the cheapest station within a municipality or route area?

## Decisions (2026-10-01)
- `dim_stations` is **overwritten** on each run (latest attributes win). Limit noted in the README.
- Fleet scenarios, two areas:
  1. **Greater Lisbon** (urban fleet): define the list of municipalities in a seed table `dim_area`, do not hard-code it in queries.
  2. **Porto-Lisbon corridor** (long-haul fleet): districts along the axis (Porto, Aveiro, Coimbra, Leiria, Santarem, Lisboa).
     `TipoPosto = 'Auto-estrada'` (612 rows in the sample) matters here: motorway stations are a separate choice from off-motorway ones.
- Both scenarios use the same fact table and differ only in the area filter and fuel mix.

## Open decisions
- Weekday patterns: do stations change prices on specific days? (needs a few weeks of snapshots)
- Exact municipality list for "Greater Lisbon" (e.g. the 18 municipalities of the Lisbon metropolitan area, or a smaller urban core).
- Whether the corridor scenario compares motorway vs off-motorway stations explicitly.
