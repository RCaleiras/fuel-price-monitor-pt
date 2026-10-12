# Phase 1: up to 90 days of recent history per station

Status: implemented 2026-10-12. Scope: only the per-station window of the dashboard (30 -> 90 days).
Not in scope (needs separate approval): national weekly series since 2004, district/municipality aggregates,
station history beyond 90 days. The national series stays separate from the per-station series (different method).

## What changed
| File | Change | Why (plain words) |
|---|---|---|
| `src/export_dashboard.py` | default window 30 -> 90 days; a repeated station x fuel pair now stops the export | The page can now look back 90 days. The site finds a price series by station and fuel, so a repeated pair would silently hide one of them: better to stop than publish it |
| `sql/tests/dashboard_*.sql` (2 files) | `INTERVAL 29 DAY` -> `89 DAY` | These checks rebuild the export independently; they must use the same window or they would compare different things |
| `tests/test_export_dashboard.py`, `tests/js/model.test.mjs` | new tests (below) | Prove the limits and that no data is invented |
| `docs/dashboard.md`, `README.md` | window text | Keep the docs true |

Unchanged on purpose: `dashboard.json` format (`schema_version` 1), the workflow, the queries (they already took the
window as a parameter), the site code, credentials, CSP. No new service. The browser still only reads one static file.

## What history exists (measured 2026-10-12)
- Per-station data starts 2026-10-01: 12 days collected, 12 of 12 calendar days have a run. The 90 days are **not**
  complete before about 2026-12-29. Until then the file holds only the days that exist (same content as the 30-day file).
- Nothing earlier can be rebuilt: the DGEG API returns only the current price, not a series.
- Earlier data that exists is the national weekly series (2004-01-02 to 2026-09-28), a different statistic, not used here.

## Data quality (measured, reproducible)
| Check | Result | How to reproduce |
|---|---|---|
| Duplicates on (station, fuel, run) in raw | 0 | `GROUP BY Id, fuel_id, collected_at HAVING COUNT(*) > 1` on `raw_station_prices` |
| Duplicates on (station, fuel, day) in staging and fact | 0 | `sql/tests/stg_station_prices_unique.sql`, `fct_station_price_daily_unique.sql` |
| Station x fuel x day seen in several runs the same day | 27,613 pair-days (days with 2-3 runs: 2026-10-01, 2026-10-11); price differs in 68 | Legitimate: more than one run per day. Rule (already in staging): keep the latest run of the day |
| Days with no run, 2026-10-01..12 | 0 of 12 | calendar vs `DISTINCT DATE(collected_at)` |
| Carried cells (not published that day) | 2.92% of pair-days overall; 4.3-5.4% on the latest days | `observed_that_day = FALSE`; never exported as prices |
| Fuel ids with several names / names with several ids | 0 / 0 | `COUNT(DISTINCT Combustivel)` per `fuel_id`, and the reverse |
| Rows mapped to unknown fuel / unknown station / suspect price | 0 / 0 / 0 | `fuel_sk = -1`, `station_sk = -1`, `is_suspect_price` in the fact |
| 30 SQL tests in `sql/tests/` | 30 of 30 return 0 rows (re-run 2026-10-12 after the window change). The one "extra line" seen once was not data, see "Intermittent test" below | `python -m src.run_sql_tests` |

Fuel naming: 12 fuels, one id per name. The two natural gas variants (GNC EUR/m3 and EUR/kg) have different units and
stay separate; "Gasóleo colorido" stays outside the fleet scope. The mapping is the existing `dim_fuel_type`
(DGEG code -> surrogate key); the original name is kept in raw. Nothing is merged by text similarity.

### Acceptance criteria
Block publication (export fails, the previous site stays online):
1. any duplicate station or station x fuel pair; 2. unknown fuel, unit other than litro/kg/m3, price <= 0;
3. no published price on the latest day; 4. more than 100,000 pairs or a file over 15 MB; 5. any `sql/tests/` file
returning rows or failing to run (`src/run_sql_tests.py`, a workflow step before the export; see "Round 2").

Warn, do not block (a missed daily run is a fact, not a reason to freeze the site): days without a run appear as empty
columns and in `coverage.n_days` versus the date span. Gaps are never filled; `null` means "not published that day".

## Retention
| Item | Before | Now |
|---|---|---|
| `raw_station_prices` (source of truth) | no expiry, append only, 207,055 rows, 43.7 MB | unchanged |
| `stg_station_prices`, `fct_station_price_daily` | no expiry, rebuilt in full each run from raw | unchanged |
| Dataset default partition expiration | 60 days (`defaultPartitionExpirationMs = 5184000000`) | **unchanged**. No table is partitioned, so nothing is deleted. Any future partitioned table must set expiration to none explicitly or it would lose rows older than 60 days |
| Table expiration | none on any table | unchanged |
| Published file | rebuilt from BigQuery every run | unchanged; derived data, always regenerable from raw |

Recovery: staging, fact and file are rebuilt from raw; BigQuery time travel is 168 h. Raw has no copy elsewhere
(a periodic backup is a later phase). No retention change was needed for Phase 1, so none was made.

## Cost and limits
| Item | Value | Status |
|---|---|---|
| Export queries, bytes processed (5 queries) | 4.6 + 4.9 + 8.7 + 4.7 + 1.4 = 24.3 MB, identical for 30 and 90 days (no partitions, full scan) | measured (dry run) |
| Billed bytes | 52,428,800 on the report-view query (5 tables x 10 MiB minimum) -> about 250 MiB/day, 7.5 GiB/month | one job measured; x5 and x30 assumed. Free tier 1 TiB/month (published) |
| Query caps | 1 GB billed, 120 s per query | in code |
| Export step duration | about 19 s, same for both windows | measured |
| Whole workflow | 1.5 to 2.3 min per run (timeout 15 min) | measured on 8 runs |
| `dashboard.json` today | 1,816,771 B (271,602 B gzip), 14,432 pairs, 3,270 stations | measured |
| `dashboard.json` at 90 full days | about 7.5 MB raw (50% of the 15 MB cap); gzip at most 2.1 MB | extrapolated from the real file with every cell filled; gzip is an upper bound (random noise added) |
| Margin | the cap would be reached at about 29,000 pairs (twice today's) | estimate |
| GitHub Pages / Actions quotas | far below the published limits | published limits, not re-verified on this account |
| Not measured | browser parse time on weak devices; behaviour with a full 90 days of real data | open |

Thresholds for the next check (when 30 and 90 days exist): file < 15 MB (cap), export step < 2 min, workflow < 10 min,
billed < 1 GB per query.

## Tests
- Python: 77 passed (69 before), `src/export_dashboard.py` 95% covered. New: default and cap are 90; `main` uses the
  default; exactly 90 days cut from a longer history; fewer than 90 days shows only existing days; gaps stay `null`
  and are never filled; repeated pair rejected; worst-case 90-day file under the cap; 91 days rejected.
- JS: 31 passed (29 before). New: period options with 12 and 90 days; trend, exact 7-day change and station history
  over 90 days. Existing behaviour is unchanged (no JS change was needed).
- SQL: the 2 dashboard tests return 0 rows with the 89-day window; full suite as in the quality table.
- Real export with the new default: `window_days` 90, 12 dates, same keys and `schema_version` as before.

## Remaining limits and risks
- The 90 days only exist from about 2026-12-29; until then the dashboard shows what exists.
- Collection gaps cannot be repaired afterwards (the source has no history).
- Station attributes are the current ones, not historical.
- The "published that day" rule may change after the 2026-10-17 stale-price re-check.
- The SQL test step is untested inside GitHub Actions (cannot run without a push); it was run locally against the
  real dataset with the same code. A false failure would stop the daily publication (the site keeps the previous day).
- The 60-day partition default is a trap for future tables (see Retention).
- Dashboard speed with many days: see "Round 2". Not a problem today (12 days), a real one before 90.

## Later phases (not started)
2. National weekly series since 2004, shown separately. 3. Daily aggregates by district/municipality and fuel.
4. Per-station history beyond 90 days (monthly files). 5. Raw backup and partition policy.

## Round 2: diagnosis, automation and performance (2026-10-12)

### Intermittent test: cause found, not a data problem
`dashboard_station_prices_match_fact` seemed to print one line once and nothing in four re-runs.
- BigQuery job history: the first run (job at 19:38:40 UTC) finished `DONE`, no error, **0 rows** (`total_rows = 0`);
  the later runs were cache hits of that same result.
- Reproduced with stdout and stderr kept apart (6 uncached runs): stdout empty every time, exit 0; in 3 of 6 the
  `bq` tool wrote `Waiting on bqjob_... Current status: DONE` to **stderr**. The original loop merged stderr into
  stdout and counted lines, so that status message looked like a result row.
- Conclusion: false positive of the measuring method (a progress message), not a test or data failure. The query is
  deterministic (set comparison, one snapshot per query). The test was not changed. Lesson: judge by exit code and
  stdout only, which is what `src/run_sql_tests.py` does through the API (no CLI text involved).

### SQL tests now run in the workflow
- New `src/run_sql_tests.py` and a step "Run SQL tests" between "Build models" and "Export dashboard". Any test
  returning rows, or failing to run, fails the job before the export, so a snapshot that breaks a data rule is not
  published. All tests run even after a failure, so one run shows every problem.
- No new permission or secret: the tests are read-only `SELECT`s using the same service account and variables as the
  other steps. Per-query caps: 200 MB billed (heaviest test bills 50 MiB), 120 s.
- Measured locally on the real dataset: 30 tests, 30 passed, about 28 s wall time, about 540 MiB billed per run
  (about 16 GiB/month against 1 TiB free). Negative paths checked against the real client with synthetic queries:
  rows -> `fail`, missing table -> `error`, invalid SQL -> `error` (never a silent pass).
- Not tested: execution inside GitHub Actions itself (needs a push, which was not authorised).
- Decision for the owner: because the step is before the export, a failing test freezes the site on the previous
  day until fixed. To only warn, move the step after the export and mark it `continue-on-error: true`.

### Dashboard speed with more days (browser, measured on this machine)
Real structure from today's export; the days before 2026-10-01 are **synthetic** (random walk, marked as such in the
file and never published), so only size and speed are meaningful, not the prices.

| Days | File | Node, one full set of calculations | Browser, one fuel change, 4x slower CPU |
|---|---|---|---|
| 12 (real) | 1.8 MB | 46 ms | about 180 ms measured without throttling |
| 30 (synthetic) | 3.1 MB | not measured | about 1.1 s |
| 60 (synthetic) | 5.3 MB | not measured | about 1.7 s |
| 90 (synthetic) | 7.4 MB | 314 ms | 2.3 to 3.0 s (first interaction 4.1 s) |

- Without throttling, 90 days cost 410 to 640 ms per interaction (against 170 to 190 ms with 12 real days).
- Time grows about linearly with the number of days, and the 7-day period costs as much as "All": the calculations
  run over every day and the period only slices the result (`site/model.js`).
- The 90-day download was 9 s under "Fast 4G" with 4x CPU, but the local test server does not compress; GitHub
  Pages serves gzip (real 12-day file: 272 KB gzip of 1.8 MB), so that figure is an upper bound. Not measured:
  real gzip transfer, real mobile devices, Safari and Firefox.
- No console errors; the page showed "All (90 days)" and the period options worked.
- Suggested thresholds (not met at 90 days with a 4x slower CPU): one interaction under 1 s at 4x CPU, file under
  15 MB (met, 50 %). The 1 s mark is reached at about 30 days, so a fix is a precondition for full 90 days on weak
  phones, not for today's 12 days. Candidate fixes (not implemented, outside this phase): compute only the days of
  the chosen period, and reuse the per-fuel series between interactions.

### Checks repeated after the changes
- `dashboard.json` schema identical to the previous file (same keys, fields, cell types, rows aligned to dates);
  only `window_days` (30 -> 90) differs. Client code untouched (`site/` diff is empty), no credentials or GCP
  identifiers in it.
- Python 87 passed (90% coverage; `run_sql_tests.py` 98%), JS 31 passed, SQL 30 of 30.
- `plan.txt` is excluded locally (`.git/info/exclude`) and `CLAUDE.md` is in `.gitignore`.
- `defaultPartitionExpirationMs` (60 days) re-read and left unchanged; nothing in this phase creates a partitioned
  table, so nothing can expire.

## Round 3: controlled close of Phase 1 (2026-10-12)

### SQL tests as a publication gate: behaviour confirmed
| Scenario | Behaviour | How it was checked |
|---|---|---|
| All tests pass | exit 0, export and deploy run | real run: 30 of 30 pass (about 28 s); unit test |
| A test returns rows (real data-quality violation) | exit 1, the job stops before "Export dashboard" and "Upload site"; `deploy` needs the job, so the site keeps the last snapshot | real client with a synthetic query -> `fail`; unit test; workflow structure test |
| BigQuery or the run fails (missing table, bad SQL, 403, quota, timeout, no credentials, no test files) | per test `error` (exit 1) with the exception text; if the runner cannot start, exit 2 and "nothing was validated" | real client: missing table -> `NotFound`, invalid SQL -> `BadRequest`; unit tests for the rest |
| Unexpected result | never a pass (see below) | real client dry runs + unit tests |

- Gap found and closed: a file in `sql/tests/` that was not a `SELECT` (a `DELETE`, `CREATE TABLE ... AS SELECT`, a
  multi-statement script) returns no rows, so it would have been read as a pass, and it would have **run** with the
  service account's write permission. The runner now asks BigQuery for the statement type with a dry run (nothing is
  executed; BigQuery reported `SELECT`, `DELETE`, `CREATE_TABLE_AS_SELECT`, `SCRIPT` as expected) and refuses anything
  but `SELECT`. It also errors on an empty file and on a partial read (rows read differ from rows reported).
- Exit codes: 0 all passed, 1 a test failed or errored, 2 the tests could not be run at all.
- `tests/test_run_sql_tests.py` also checks the workflow file: the step sits after "Build models" and before the
  export and the upload, has no `if:`, `continue-on-error`, `always()` or `failure()`, and `deploy` needs `collect`.
- Quality failures were not turned into warnings. Failures remain blocking.
- **Not validated: execution inside GitHub Actions.** The workflow runs only on a schedule or by hand, and a run writes
  a collector snapshot to BigQuery and can deploy. Running it from the branch is not risk free, so it was not done.
  Treat the workflow as validated by structure and by local execution of the same command, not by a real run.

### Browser: the cost and the minimal fix
- Cost path (`site/model.js`): `trend()` computed one summary (a sort) for every day and then cut to the period, so
  7 days cost as much as All; `kpi()` recomputed the full daily series of a fuel on every call (6 cards, plus once more
  for the summary sentence, which does not use it). The series only depends on the fuel and the area, brand and type
  filters, not on the period, the inspected day or the sort.
- Fix (local, no new feature, no new dependency, published JSON and BigQuery untouched):
  `seriesByDay(pairs, nDays, from)` skips days before `from`; `trend()` computes only the days of the chosen period (or
  slices the cached series); `kpi().series` is computed on first read and cached per fuel and filters, inside
  `createData` (a new data object has a new cache), with at most 64 entries and frozen arrays.
- Equivalence: code before (committed `HEAD`) against code after on 90 days of synthetic data, 256 states (3 filters,
  2 periods, 2 inspected days, with and without compare mode) in both call orders: kpi (with series), trend, groups,
  scope summary, station rows, movers and map points identical. `tests/js/series_cache.test.mjs` keeps this as 10
  permanent tests (synthetic data, marked as such); run against the old code, 7 of them fail, as they should.

### Performance, before and after (measured, Node, no CPU throttling, 90 days)
Real structure of the local export (3,260 stations, 14,381 station x fuel series); the 78 days before the first real
day are **synthetic** (seeded random walk), so only speed is meaningful. Median per interaction of everything the page
asks of the data layer (seven price cards and sparklines, summary, trend, comparison, groups, rows, map points, movers):

| Interaction | Before | After | Change |
|---|---|---|---|
| Switch fuel | 709-719 ms | 20-21 ms | -97% |
| Change period (7, 14, 30, All) | 606-624 ms | 20 ms | -97% (7 days = All) |
| Change district | 35-40 ms | 14 ms | -60% |
| First interaction after load | 846-878 ms | 596-601 ms | -30% |
| 12 days (one run): first / fuel / period | 142 / 103 / 99 ms | 41 / 10 / 7 ms | |

- Two rounds each, same machine, versions alternated. The machine was about 3x slower than in round 2 (the same
  "before" fuel switch measured 233 ms then), so read ratios, not absolute times, across rounds.
- **Not measured, estimates only:** a browser under 4x CPU throttle (the browser tooling did not connect in this
  session). Scaling the measured ratios, switching fuel or period at 90 days should fall from the 2.3-3.0 s of round 2
  to roughly 0.1 s, and the first interaction from about 4 s to roughly 3 s. Real phones, gzip transfer, Safari and
  Firefox are still unmeasured.
- What remains: the first interaction still computes six daily series (one per price card), linear in days. If that
  is not enough, options that need authorisation: one pass for all fleet fuels, drawing the sparklines after the first
  paint, a selection-based median instead of a full sort, or daily summaries precomputed in the export (changes the
  published structure).

### Period selector
Unchanged: `7 / 14 / 30 / All`. No 60 or 90 day option was added and no interface was changed.
