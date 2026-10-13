# Browser timing under CPU throttle

Reproducible way to compare two builds of `site/` in a real browser with a slower CPU. It uses **synthetic** data
(real structure, invented earlier days) and never touches BigQuery, GitHub Pages or any published file.

## What it measures
Initial load, first interaction, change of fuel, change of period, change of district. An "interaction" is the time from
the event to the second animation frame (JS + layout), an approximation of input-to-paint, not the INP metric.
Versions are alternated on every repetition and the first run is discarded as warm-up.

## Run
Needs Node 22+ (global `WebSocket`), Python 3.12+ and Chrome. Paths below are examples; `OUT` is any folder outside the
repo.

```bash
# 1. the two builds to compare (here: main before a change, and the current branch)
mkdir -p OUT/before OUT/after
git archive origin/main site | tar -x -C OUT/before
git archive HEAD site | tar -x -C OUT/after

# 2. the same synthetic 90-day file in both (needs a local site/data/dashboard.json from export_dashboard)
python tests/perf/gen_synthetic.py site/data/dashboard.json OUT/before/site/data/dashboard.json 90
cp OUT/before/site/data/dashboard.json OUT/after/site/data/dashboard.json

# 3. serve both, locally only
(cd OUT/before/site && python -m http.server 8101 --bind 127.0.0.1) &
(cd OUT/after/site  && python -m http.server 8102 --bind 127.0.0.1) &

# 4. measure: CPU slowdown 4x, 7 repetitions, results to a JSON file
node tests/perf/measure.mjs 4 7 OUT/result_cpu4.json
```

Environment variables: `BEFORE_URL`, `AFTER_URL` (default the two ports above), `CHROME_PATH` (default the Windows
Chrome path), `DEBUG_PORT` (default 9333).

## Reading the result
`summary.before` and `summary.after` hold, per measure, `median_ms`, `min_ms` and `max_ms`. Compare medians, look at
the spread, and report `cpu_throttle`, `repetitions` and `browser` with the numbers. The run fails instead of
reporting when a period click does not change the page state.

## Limits
- Headless Chrome on one desktop machine, viewport 1280x900; not a real phone, Safari or Firefox.
- No gzip (the local server does not compress; GitHub Pages does), so the load time is an upper bound.
- Machine noise is real: alternate versions, repeat, and compare ratios rather than absolute times across sessions.
- The prices are synthetic. The generated file is marked `"synthetic": true` and must never be published or committed.
- Reference numbers (4x CPU, 90 synthetic days, 7 repetitions) are in `docs/history_phase1.md`, "Round 4".
