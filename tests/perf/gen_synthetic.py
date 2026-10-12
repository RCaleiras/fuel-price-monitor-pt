"""Build a SYNTHETIC dashboard.json with more days than exist, for browser timing only.

Keeps the real structure of an export (stations, series, activity) and extends every series backwards with a seeded
random walk, so only size and speed are meaningful, never the prices. The output carries `"synthetic": true`.
It must never be published or committed.

Usage: python tests/perf/gen_synthetic.py site/data/dashboard.json OUT/data/dashboard.json 90
"""

import datetime as dt
import json
import random
import sys
from pathlib import Path

SEED = 20261012
PRICE_STEPS = [0, 0, 0, 0, 0, 0, -10, 10, -5, 5]  # thousandths of a euro, mostly flat like the real series
MIN_PRICE = 100


def extend(export: dict, n_days: int, seed: int = SEED) -> dict:
    """Return a new export with `n_days` dates; the days before the first real one are synthetic."""
    rng = random.Random(seed)
    real = [dt.date.fromisoformat(d) for d in export["dates"]]
    extra = n_days - len(real)
    if extra < 0:
        raise ValueError(f"export already has {len(real)} days, more than the {n_days} requested")
    first = real[0]
    pre = [(first - dt.timedelta(days=extra - i)).isoformat() for i in range(extra)]

    rows = []
    for station, fuel, prices, updated_at in export["prices"]["rows"]:
        current = next((p for p in prices if p is not None), None)
        walk: list[int | None] = []
        for _ in range(extra):
            if current is None:
                walk.append(None)
                continue
            current = max(MIN_PRICE, current + rng.choice(PRICE_STEPS))
            walk.append(current)
        rows.append([station, fuel, walk[::-1] + prices, updated_at])

    by_fuel: dict[int, list[dict]] = {}
    for item in export["activity"]:
        by_fuel.setdefault(item["fuel"], []).append(item)
    activity = []
    for items in by_fuel.values():
        activity.extend({**items[0], "date": day, "changes": 0, "carried": 0} for day in pre)
        activity.extend(items)

    return {
        **export,
        "dates": pre + export["dates"],
        "prices": {**export["prices"], "rows": rows},
        "activity": activity,
        "window_days": n_days,
        "coverage": {**export["coverage"], "first_date": pre[0] if pre else export["dates"][0], "n_days": n_days},
        "source": "SYNTHETIC test data, not DGEG prices; never publish",
        "synthetic": True,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__)
        return 2
    src, out, n_days = Path(argv[1]), Path(argv[2]), int(argv[3])
    try:
        result = extend(json.loads(src.read_text(encoding="utf-8")), n_days)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"{out}: {len(result['dates'])} dates, {len(result['prices']['rows'])} series (SYNTHETIC)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
