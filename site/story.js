// Plain-English summaries generated from the same numbers as the KPIs. No DOM. Tested by tests/js/model.test.mjs.
// When a comparison is not reliable the sentence says so; it never invents a trend.
import { formatCount, formatDate, formatEuro, formatPercent } from "./lib.js";
import { MIN_BRAND_STATIONS, areaLabel, brandLabel, typeLabel } from "./model.js";

const UNIT_WORD = { litro: "litre", kg: "kg", m3: "m³" };
const stations = (n) => `${formatCount(n)} station${n === 1 ? "" : "s"}`;

/** The summary sentence as segments; `strong` marks the figures a reader should see first. */
export function summarySegments(data, state) {
  const k = data.kpi(state, state.fuel);
  const f = k.fuel;
  const unit = UNIT_WORD[f.unit] ?? f.unit;
  const where = [areaLabel(state), state.brand ? `at ${brandLabel(state.brand)}` : "", state.type ? `(${typeLabel(state.type).toLowerCase()} stations)` : ""]
    .filter(Boolean).join(" ");
  const when = data.isLatest(state) ? `on ${formatDate(k.dayIso)}, the latest day collected` : `on ${formatDate(k.dayIso)}`;
  if (!k.current) return [{ text: `No station published a ${f.label} price in ${where} ${when}. Try a wider area, another brand or another fuel.` }];
  const out = [{ text: `${f.label} cost a median ` }, { text: `${formatEuro(k.current.median)} a ${unit}`, strong: true }, { text: ` in ${where} ${when}` }];
  if (k.comparable && k.delta !== 0) {
    out.push({ text: ", " }, { text: `${formatEuro(Math.abs(k.delta))} ${k.delta < 0 ? "less" : "more"}`, strong: true },
      { text: ` than a week earlier (${formatPercent(k.deltaPct)})` });
  } else if (k.comparable) {
    out.push({ text: ", the same as a week earlier" });
  } else {
    out.push({ text: ` (${k.reason.replace(/^No comparison: /, "no week-on-week comparison: ")})` });
  }
  out.push({ text: `. Based on ${stations(k.current.n)}.` });
  return out;
}

/** One sentence naming the cheapest and dearest group, with the station counts behind each median. */
export function compareSentence(data, state) {
  const g = data.groups(state);
  if (g.rows.length === 0) return "";
  if (g.rows.length === 1) return `Only one ${g.key === "type" ? "station type" : g.key} has prices for this selection.`;
  const unit = UNIT_WORD[data.fuelById.get(state.fuel).unit] ?? "";
  const lo = g.rows[0];
  const hi = g.rows[g.rows.length - 1];
  const gap = `a gap of ${formatEuro(hi.median - lo.median)} a ${unit}`;
  const cheap = `median ${formatEuro(lo.median)}, ${stations(lo.n)}`;
  const dear = `${formatEuro(hi.median)}, ${stations(hi.n)}`;
  if (g.key === "brand") return `Among brands with at least ${MIN_BRAND_STATIONS} stations, ${lo.label} is the cheapest (${cheap}) and ${hi.label} the dearest (${dear}): ${gap}.`;
  if (g.key === "type") return `${lo.label} stations are the cheapest (${cheap}); ${hi.label.toLowerCase()} stations the dearest (${dear}): ${gap}.`;
  return `The cheapest ${g.key} is ${lo.label} (${cheap}); the dearest is ${hi.label} (${dear}): ${gap}.`;
}
