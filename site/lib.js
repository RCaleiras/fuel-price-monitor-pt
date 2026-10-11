// Pure dashboard logic: no DOM, no network. Tested by tests/js/lib.test.mjs (node --test tests/js/).
// Prices arrive in milli-euro integers (2.207 EUR -> 2207); null means "no price published that day".

const UNIT_LABEL = { litro: "l", kg: "kg", m3: "m³" };
const NUMBER = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const PERCENT = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const DAY_MS = 86_400_000;

/** The JSON file as objects: stations by position, fuels by id, one entry per station x fuel. */
export function loadModel(payload) {
  const fields = payload.stations.fields;
  const stations = payload.stations.rows.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
  const fuels = new Map(payload.fuels.map((f) => [f.id, f]));
  const pairs = payload.prices.rows.map(([station, fuel, prices, updatedAt]) => ({
    station: stations[station],
    fuel,
    prices,
    updatedAt,
  }));
  return { ...payload, stations, fuels, pairs, latestIndex: payload.dates.length - 1 };
}

/** The station x fuel pairs that match every active filter (empty filter = no restriction). */
export function filterPairs(model, { fuel, district = "", municipality = "" }) {
  return model.pairs.filter(
    (p) =>
      p.fuel === fuel &&
      (!district || p.station.district === district) &&
      (!municipality || p.station.municipality === municipality),
  );
}

/** Linear-interpolation quantile of an ascending array (same rule as BigQuery PERCENTILE_CONT). */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** n, median, mean, min, max, P10, P90 of a list of prices, or null when there is none (never 0). */
export function summarize(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, v) => acc + v, 0);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    mean: total / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

/** The published prices of the given pairs on one day. */
export function dayValues(pairs, dayIndex) {
  const out = [];
  for (const p of pairs) {
    const v = p.prices[dayIndex];
    if (v !== null && v !== undefined) out.push(v);
  }
  return out;
}

/** One summary per day (null on a day with no published price). */
export function seriesByDay(pairs, nDays) {
  return Array.from({ length: nDays }, (_, i) => summarize(dayValues(pairs, i)));
}

/** Index of the date `days` before the latest date, or null if it is outside the window. */
export function referenceIndex(dates, days) {
  if (dates.length === 0) return null;
  const target = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
  const idx = dates.indexOf(target);
  return idx === -1 ? null : idx;
}

/** Median on the latest day vs a reference day. delta is null unless both days have prices; pct needs a reference > 0. */
export function compareDays(pairs, latestIndex, refIndex) {
  const current = summarize(dayValues(pairs, latestIndex));
  const reference = refIndex === null ? null : summarize(dayValues(pairs, refIndex));
  const delta = current && reference ? current.median - reference.median : null;
  const deltaPct = delta !== null && reference.median > 0 ? delta / reference.median : null;
  return { current, reference, delta, deltaPct };
}

/** Latest-day summary per district or municipality, cheapest median first. */
export function groupSummary(pairs, _stations, dayIndex, key) {
  const groups = new Map();
  for (const p of pairs) {
    const v = p.prices[dayIndex];
    if (v === null || v === undefined) continue;
    const k = p.station[key] ?? "Unknown";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  return [...groups.entries()]
    .map(([k, values]) => ({ key: k, ...summarize(values) }))
    .sort((a, b) => a.median - b.median || a.key.localeCompare(b.key, "pt"));
}

/** Stations whose price changed between the reference day and the latest day (both published), largest change first. */
export function movers(pairs, _stations, latestIndex, refIndex) {
  if (refIndex === null) return [];
  const out = [];
  for (const p of pairs) {
    const now = p.prices[latestIndex];
    const before = p.prices[refIndex];
    if (now === null || before === null || now === undefined || before === undefined || now === before) continue;
    out.push({ station: p.station, before, now, change: now - before });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.change - a.change);
}

/** 2207, "litro" -> "2,207 €/l"; a missing price is "sem dados", never 0. */
export function formatPrice(milli, unit) {
  if (milli === null || milli === undefined || Number.isNaN(milli)) return "sem dados";
  return `${NUMBER.format(milli / 1000)} €/${UNIT_LABEL[unit] ?? unit}`;
}

/** +0,050 €/l (signed, euros). */
export function formatDelta(milli, unit) {
  if (milli === null) return "sem comparação";
  const sign = milli > 0 ? "+" : milli < 0 ? "−" : "±";
  return `${sign}${NUMBER.format(Math.abs(milli) / 1000)} €/${UNIT_LABEL[unit] ?? unit}`;
}

export function formatPercent(ratio) {
  return ratio === null ? "" : `${PERCENT.format(ratio * 100)} %`;
}

/** "2026-10-11" -> "11/10/2026". */
export function formatDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Whole UTC days between the data day and `now`. */
export function staleDays(latestIso, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - Date.parse(`${latestIso}T00:00:00Z`)) / DAY_MS);
}

export function unitLabel(unit) {
  return UNIT_LABEL[unit] ?? unit;
}
