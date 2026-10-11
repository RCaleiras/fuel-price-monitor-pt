// Pure dashboard logic: no DOM, no network. Tested by tests/js/lib.test.mjs (node --test tests/js/).
// Prices arrive in milli-euro integers (2.207 EUR -> 2207); null means "no price published that day".

const UNIT_LABEL = { litro: "L", kg: "kg", m3: "m³" };
const NUM3 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const NUM2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat("en-GB");
const PERCENT = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const LISBON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const UTC_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DAY_MS = 86_400_000;
const MINUS = "−";

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
  return referenceFor(dates, dates.length - 1, days).index;
}

/** The date `days` before dates[index] (ISO) and its position in `dates`, or index null when it is not there. */
export function referenceFor(dates, index, days) {
  const iso = new Date(Date.parse(`${dates[index]}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
  const idx = dates.indexOf(iso);
  return { index: idx === -1 ? null : idx, iso };
}

/** Median on the latest day vs a reference day. delta is null unless both days have prices; pct needs a reference > 0. */
export function compareDays(pairs, latestIndex, refIndex) {
  const current = summarize(dayValues(pairs, latestIndex));
  const reference = refIndex === null ? null : summarize(dayValues(pairs, refIndex));
  const delta = current && reference ? current.median - reference.median : null;
  const deltaPct = delta !== null && reference.median > 0 ? delta / reference.median : null;
  return { current, reference, delta, deltaPct };
}

/** One day's summary per group (district, municipality, brand...), cheapest median first. */
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
    .sort((a, b) => a.median - b.median || String(a.key).localeCompare(String(b.key), "pt"));
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

/** Five equal-count price bands for the map legend (by quantile of the shown prices). */
export function priceBins(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const edges = [0.2, 0.4, 0.6, 0.8].map(at);
  const bins = [];
  let lo = sorted[0];
  for (const edge of [...edges, sorted[sorted.length - 1]]) {
    if (bins.length && edge <= bins[bins.length - 1].max) continue; // merge equal edges (few distinct prices)
    bins.push({ min: lo, max: edge });
    lo = edge;
  }
  return bins;
}

// ---------- formatting (en-GB, euro, three decimals like DGEG) ----------
const missing = (v) => v === null || v === undefined || Number.isNaN(v);

export function unitLabel(unit) {
  return UNIT_LABEL[unit] ?? unit;
}

/** 2207, "litro" -> "€2.207/L"; a missing price is "No data", never 0. */
export function formatPrice(milli, unit) {
  return missing(milli) ? "No data" : `€${NUM3.format(milli / 1000)}/${unitLabel(unit)}`;
}

/** 2207 -> "€2.207" (no unit, for compact places where the unit is stated nearby). */
export function formatEuro(milli) {
  return missing(milli) ? "–" : `€${NUM3.format(milli / 1000)}`;
}

/** Axis ticks: 2200 -> "€2.20". */
export function formatAxis(milli) {
  return `€${NUM2.format(milli / 1000)}`;
}

/** -35 -> "−€0.035" (signed, euros, true minus sign). */
export function formatDelta(milli) {
  if (missing(milli)) return "–";
  const sign = milli > 0 ? "+" : milli < 0 ? MINUS : "±";
  return `${sign}€${NUM3.format(Math.abs(milli) / 1000)}`;
}

/** -0.0153 -> "−1.5%". */
export function formatPercent(ratio) {
  return missing(ratio) ? "" : `${PERCENT.format(ratio * 100).replace("-", MINUS)}%`;
}

export const formatCount = (n) => INT.format(n);
const at = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** "2026-10-11" -> "11 Oct 2026". */
export const formatDate = (iso) => DATE.format(at(iso));
/** "2026-10-11" -> "11 Oct". */
export const formatDay = (iso) => DAY.format(at(iso));
/** "2026-10-11" -> "Sun 11 Oct". */
export const formatWeekday = (iso) => WEEKDAY.format(at(iso));
/** DGEG update time (UTC instant) shown in Lisbon time. */
export const formatLisbon = (iso) => (iso ? LISBON.format(new Date(iso)) : "–");
export const formatUtc = (iso) => `${UTC_TIME.format(new Date(iso))} UTC`;

/** "up" | "down" | "flat" | "none" for a signed change. */
export function direction(milli) {
  if (missing(milli)) return "none";
  return milli > 0 ? "up" : milli < 0 ? "down" : "flat";
}

/** Whole UTC days between the data day and `now`. */
export function staleDays(latestIso, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - at(latestIso)) / DAY_MS);
}
