# Public dashboard (updated 2026-10-11)

A static site on GitHub Pages that reads one JSON file produced every day by the pipeline. The browser never talks
to BigQuery. Cost: €0 (see "Cost").

## Data flow
```
collect-fuel-prices (GitHub Actions, daily 06:01 UTC + manual)
  job collect: Run collector -> Build models -> Export dashboard -> Upload site (Pages artifact)
  job deploy:  deploy-pages (only when the repo variable DASHBOARD_DEPLOY = true)
```
- `src/export_dashboard.py` runs the five queries in `sql/dashboard/` (they read `rpt_station_price_daily` only),
  validates the result and writes `site/data/dashboard.json`. If a check fails it writes nothing, the job turns red,
  and the site keeps the previous deploy.
- The JSON is built in CI and deployed with the site; it is never committed (`site/data/` is git-ignored).
- Each deploy replaces the whole site at once, so the page never mixes two days.

## The JSON file (`schema_version` 1)
| Key | Content |
|---|---|
| `generated_at` | export time, UTC (`YYYY-MM-DDTHH:MM:SSZ`) |
| `coverage` | first and latest collection day and number of days collected (whole history) |
| `window_days`, `dates` | the days shown: up to 30, ending on the latest day |
| `fuels` | `id` (= `fuel_sk`), `name`, `unit` (`litro`, `kg`, `m3`), `fleet` |
| `stations` | `fields` + `rows`: DGEG code, name, type, brand, district, municipality, locality, address, lat, lon |
| `prices` | `rows` of `[station position, fuel id, [price per date], last DGEG update (UTC)]`. Prices are milli-euro integers (2.207 EUR -> 2207); `null` = not published that day |
| `activity` | per fuel and day: published, carried (excluded), changed and suspect counts |

## KPI definitions
All prices: published that day (`observed_that_day = TRUE`) and not suspect (`is_suspect_price = FALSE`). Carried
prices of stations DGEG stopped publishing are excluded and counted separately. Computed per fuel; units never mixed.

| KPI | Formula | Where |
|---|---|---|
| Median price | exact median (linear interpolation, like `PERCENTILE_CONT(…, 0.5)`) of the day's prices | price board, stats, summary |
| Mean, min, max, stations | simple mean, min, max, count of the same prices | stats |
| Change | median(day) − median(day − 7), same filters; hidden if either day has no price, or if the station counts of the two days differ by more than 20% (the change would reflect which stations published); % only when the reference > 0 | price board, summary |
| Daily evolution | median, P10, P90 per day (one median line per fuel in compare mode) | trend chart |
| Comparison | median, P10, P90, min, max, n per district / municipality / locality, per brand (≥ 10 stations) or per station type on the day | comparison chart |
| vs median | station price − median of the current filters, same day | station table |
| Movers | per station: price on the day − price 7 days before, only stations published on both days | movers tables |
| Price changes (country) | `is_price_change` among published prices, that day | stats (no area, brand or type filter only) |

"The day" is the latest collected day unless the reader inspects an earlier day on the trend chart (see below).
All calculations happen in the browser over the exported prices (`site/lib.js`, selected by `site/model.js`), so every
filter combination uses the same rules. The simple median and mean are not the DGEG official weekly average
(volume-weighted, about 2–3% lower).

## Interface (redesign 2026-10-11)
English throughout (en-GB formats: `€2.224/L`, `11 Oct 2026`). Fuel names are English with DGEG's Portuguese name
alongside; places, brands and station names are shown exactly as published (brand names only have stray spaces
trimmed). Layout: filter rail (a bottom sheet on phones), selection bar with removable chips, a one-sentence summary,
the graphite price board, then linked panels.

| Interaction | What it does |
|---|---|
| Fuel card on the price board | selects that fuel in every panel; hover/focus shows median, P10–P90, change and station count |
| Filters (fuel, chart period, district, municipality, brand, station type) | narrow every panel; each active filter is a chip with its own ✕; "Reset all" clears them |
| Compare fuels | median lines of the litre-priced fleet fuels on one axis; legend buttons show/hide series (premium grades dashed) |
| Click a day on the trend chart (or Enter) | historical view: board, summary, comparison, map, table and movers show that day; a banner and a chip say so; "Back to latest" or Esc returns |
| Comparison row | region rows drill down (district → municipality); brand and type rows filter the whole page (the brand/type chart itself ignores its own filter so the selection stays in context) |
| Map dot, table row, mover row | opens the station drawer: every fuel it published that day, its history, its gap to the district median |
| Table row hover/focus | rings the station on the map |
| `/` and Esc | focus search; close drawer/sheet or return to the latest day |

The URL keeps the whole selection (`fuel`, `district`, `municipality`, `brand`, `type`, `days`, `day`, `group`, `sort`,
`dir`, `station`, `q`), validated against the data on load; the first dashboard's Portuguese parameters
(`combustivel`, `distrito`, `concelho`, `periodo=7`) still open the same view. Files: `site/lib.js` (calculations and
formatting), `site/model.js` (derived data, state, URL), `site/story.js` (generated sentences), `site/charts.js`,
`site/ui.js`, `site/views.js`, `site/app.js`, `site/styles.css`. Fonts are the device's own (no downloads).

## Verification (2026-10-11)
- `python -m pytest --cov=src -q`: 69 passed; `src/export_dashboard.py` 95% covered.
- `node --test "tests/js/*.test.mjs"`: 12 passed (`site/lib.js`).
- Redesign (same day): `node --test "tests/js/*.test.mjs"`: 29 passed (`site/lib.js`, `site/model.js`, `site/story.js`).
  Rendered in a browser at 1440×900 and 375×812, light and dark: the same figures as below (Gasóleo simples 2.224,
  n 2,844, mean 2.208, range 1.939–2.399, change −0.035; Gasolina simples 95 Faro 2.1365 shown as €2.137, n 176;
  station 65363 €2.239). Not tested: screen readers, real touch devices, Firefox/Safari, reduced-motion emulation.
- `sql/tests/dashboard_station_prices_match_fact.sql` and `dashboard_stations_unique.sql`: 0 rows.
- Browser vs independent SQL on the fact table, latest day 2026-10-11, all equal:
  Gasóleo simples national median 2.224 (n 2,844, mean 2.2084, min 1.939, max 2.399); 7-day change −0.035 (reference
  2.259 on 2026-10-04); Gasolina simples 95 in Faro median 2.1365 (n 176); station 65363 Gasóleo simples 2.239.

## Setup (one time, by the repo owner)
1. Merge the PR.
2. Make the repository public (Settings > General > Danger Zone > Change visibility). Pages is free only on public
   repos. Note: commit metadata shows the author email (accepted by the owner).
3. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
4. Settings > Secrets and variables > Actions > Variables: add `DASHBOARD_DEPLOY` = `true`.
5. Actions > collect-fuel-prices > Run workflow. The site appears at
   `https://rcaleiras.github.io/fuel-price-monitor-pt/`.
6. Settings > Environments > github-pages > Deployment branches: allow `main` only.
7. Settings > Actions > General > Fork pull request workflows: require approval for all outside collaborators.
8. Recommended: a budget alert of €1 on the GCP project (Billing > Budgets & alerts), and check that no IAM binding
   grants `allUsers` / `allAuthenticatedUsers` (the project id is visible in the public SQL; it is not a secret).

Note: GitHub disables scheduled workflows in a public repo after 60 days without commits. Any commit restarts the
count; if it happens, re-enable the workflows under Actions.

## Run locally
```
python -m src.export_dashboard --out site/data     # needs GCP_PROJECT in .env and ADC login
python -m http.server 8765 -d site                 # open http://localhost:8765
node --test "tests/js/*.test.mjs"
```

## Cost
| Item | Why €0 |
|---|---|
| GitHub Pages | free on public repos (indicative limits: 1 GB site, 100 GB/month traffic; the JSON is ~1.7 MB, ~270 KB compressed, at 11 days) |
| GitHub Actions | free minutes on public repos |
| BigQuery | 5 queries/day × ~50 MB billed (the minimum for the 5 tables behind the view) ≈ 7.5 GB/month, against 1 TiB/month free. Each query is capped at 1 GB billed and 2 minutes |
Visitors never reach GCP: they only download static files from GitHub.

## Security
- No endpoint, SQL, credential or Google Cloud identifier reaches the browser; the site is static files.
- Queries are fixed files; the only parameter (window in days, 1–90) is a typed query parameter.
- Content-Security-Policy (meta tag): scripts, styles, data only from the site itself; no third-party requests (the
  map has no tile server; charts are plain SVG).
- Data text is always inserted with `textContent`, never as HTML.
- Error messages shown to visitors are generic.
- The workflow's deploy job has only `pages: write` and `id-token: write`; the collect job keeps `contents: read`.

## Limits
- History is short (since 2026-10-01); the window grows to 30 days. Older weekly national data (2010+) is not shown.
- The "published that day" rule may change after the 2026-10-17 re-check of stale prices.
- Station name, brand and address are the current ones (no history). About 8% of stations have the brand "Genérico".
- Mainland Portugal only. GitHub may start the daily run late or skip it; the page always shows the data date and
  warns when it is more than 2 days old.
