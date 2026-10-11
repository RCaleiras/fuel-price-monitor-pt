// Dashboard charts: plain SVG, no library, no third-party requests. Data text is always set with textContent.
// Colours come from CSS (series carry a fuel-family class), so the stylesheet owns every colour.
import { formatAxis, formatCount, formatDay, formatEuro, formatPrice, formatWeekday, priceBins } from "./lib.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HIT_RADIUS_PX = 14; // map: the pointer only has to be closest to a station, within this distance

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, value, attrs = {}) {
  const node = el("text", { x, y, ...attrs }, parent);
  node.textContent = value;
  return node;
}

export function emptyNode(message, actions = []) {
  const box = document.createElement("div");
  box.className = "fm-empty";
  const p = document.createElement("p");
  p.textContent = message;
  box.appendChild(p);
  for (const { label, onClick } of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fm-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    box.appendChild(b);
  }
  return box;
}

const widthOf = (container, fallback) => Math.max(280, Math.round(container.clientWidth || fallback));

function ticks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

const seriesClass = (s) => `fam-${s.family}${s.premium ? " premium" : ""}${s.focus ? " focus" : ""}`;

// ---------- tooltip (one per page) ----------
function tipNode() {
  let tip = document.getElementById("fm-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "fm-tip";
    tip.className = "fm-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

/** rows: [{ value, label, series? }] — the value leads, the label follows; series adds a line key in its colour. */
export function showTip(x, y, title, rows = [], hint = "") {
  const tip = tipNode();
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "fm-tip-title";
  head.textContent = title;
  tip.appendChild(head);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "fm-tip-row";
    if (r.series) {
      const key = document.createElement("i");
      key.className = `fm-key ${seriesClass(r.series)}`;
      row.appendChild(key);
    }
    const strong = document.createElement("strong");
    strong.textContent = r.value;
    const span = document.createElement("span");
    span.textContent = r.label ?? "";
    row.append(strong, span);
    tip.appendChild(row);
  }
  if (hint) {
    const h = document.createElement("div");
    h.className = "fm-tip-hint";
    h.textContent = hint;
    tip.appendChild(h);
  }
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - width - 8);
  const top = y + 16 + height > window.innerHeight ? y - height - 12 : y + 16;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  tipNode().hidden = true;
}

const anchor = (node) => {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + 8];
};

/** Hover + focus tooltip for any HTML element (KPI cards, info icons). */
export function attachTip(node, getContent) {
  const show = (x, y) => { const c = getContent(); showTip(x, y, c.title, c.rows, c.hint); };
  node.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(e.clientX, e.clientY); });
  node.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(e.clientX, e.clientY); });
  node.addEventListener("pointerleave", hideTip);
  node.addEventListener("focus", () => { if (!node.matches(":focus-visible")) return; const [x, y] = anchor(node); show(x, y + node.getBoundingClientRect().height - 8); });
  node.addEventListener("blur", hideTip);
}

// ---------- daily trend: one median line per fuel, P10–P90 band when a single fuel is shown ----------
/**
 * @param {{ dates: string[], series: Array<{label:string, short:string, family:string, premium:boolean, points:Array<object|null>}>,
 *   unit: string, band: boolean, selected: number|null, onSelectDay: (i:number|null) => void, height?: number }} opts
 */
export function renderTrend(container, { dates, series, unit, band, selected, onSelectDay, height = 280 }) {
  const present = series.flatMap((s) => s.points.filter(Boolean));
  if (series.length === 0) {
    container.replaceChildren(emptyNode("All series are hidden. Turn one on in the legend."));
    return;
  }
  if (present.length === 0) {
    container.replaceChildren(emptyNode("No published prices for these filters in this period."));
    return;
  }
  const W = widthOf(container, 760);
  const narrow = W < 520;
  const H = height, L = 50, R = narrow ? 74 : 132, T = 22, B = 28;
  const showBand = band && series.length === 1;
  const lows = present.map((p) => (showBand ? p.p10 : p.median));
  const highs = present.map((p) => (showBand ? p.p90 : p.median));
  const lo = Math.min(...lows), hi = Math.max(...highs);
  const pad = Math.max((hi - lo) * 0.1, 6);
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i) => (dates.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (dates.length - 1));
  const y = (v) => T + ((y1 - v) * (H - T - B)) / (y1 - y0);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fm-trend", role: "img", tabindex: 0, "data-fk": "trend",
    "aria-label": `Daily median price${series.length > 1 ? "s" : ""} of ${series.map((s) => s.label).join(", ")}, ${formatDay(dates[0])} to ${formatDay(dates[dates.length - 1])}. Left and right arrows move between days, Enter inspects a day, Escape returns to the latest day.` });
  for (const t of ticks(y0, y1)) {
    el("line", { class: "grid", x1: L, x2: W - R, y1: y(t), y2: y(t) }, svg);
    text(svg, L - 8, y(t) + 4, formatAxis(t), { "text-anchor": "end", class: "tick" });
  }
  el("line", { class: "axis", x1: L, x2: W - R, y1: H - B, y2: H - B }, svg);
  const every = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor((W - L - R) / 64))));
  dates.forEach((d, i) => {
    if (i % every === 0 || i === dates.length - 1) text(svg, x(i), H - B + 18, formatDay(d), { "text-anchor": "middle", class: "tick" });
  });

  if (selected !== null && selected >= 0 && selected < dates.length) {
    el("rect", { class: "sel-day", x: x(selected) - 10, y: T - 6, width: 20, height: H - T - B + 6, rx: 4 }, svg);
    text(svg, x(selected), T - 10, `Viewing ${formatDay(dates[selected])}`, { "text-anchor": "middle", class: "sel-label" });
  }

  for (const s of series) {
    const g = el("g", { class: `series ${seriesClass(s)}` }, svg);
    const runs = [];
    let run = [];
    s.points.forEach((p, i) => {
      if (p) run.push({ i, ...p });
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    for (const r of runs) {
      if (showBand && r.length > 1) {
        const upper = r.map((p) => `${x(p.i)},${y(p.p90)}`);
        const lower = [...r].reverse().map((p) => `${x(p.i)},${y(p.p10)}`);
        el("polygon", { class: "band", points: [...upper, ...lower].join(" ") }, g);
      }
      if (r.length > 1) el("polyline", { class: "line", points: r.map((p) => `${x(p.i)},${y(p.median)}`).join(" ") }, g);
      else el("circle", { class: "pt", cx: x(r[0].i), cy: y(r[0].median), r: 4 }, g);
    }
  }

  // direct labels at the line ends (value in ink, a short key in the series colour), nudged apart to avoid overlap
  const ends = series.map((s) => {
    const last = [...s.points.keys()].reverse().find((i) => s.points[i]);
    return last === undefined ? null : { s, i: last, v: s.points[last].median, yy: y(s.points[last].median) };
  }).filter(Boolean).sort((a, b) => a.yy - b.yy);
  for (let k = 1; k < ends.length; k++) ends[k].yy = Math.max(ends[k].yy, ends[k - 1].yy + 15);
  for (const e of ends) {
    const g = el("g", { class: `end-label ${seriesClass(e.s)}` }, svg);
    el("line", { class: "key", x1: W - R + 8, x2: W - R + 20, y1: e.yy, y2: e.yy }, g);
    text(g, W - R + 24, e.yy + 4, narrow ? formatEuro(e.v) : `${e.s.short} ${formatEuro(e.v)}`, { class: "end-text" });
  }

  const cross = el("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" }, svg);
  const markers = series.map((s) => el("circle", { class: `marker ${seriesClass(s)}`, r: 5, visibility: "hidden" }, svg));
  const overlay = el("rect", { x: L - 6, y: T, width: W - L - R + 12, height: H - T - B, class: "overlay" }, svg);
  let current = selected ?? dates.length - 1;
  let touchArmed = null;

  const show = (i, cx, cy) => {
    current = i;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const rows = [];
    series.forEach((s, k) => {
      const p = s.points[i];
      markers[k].setAttribute("visibility", p ? "visible" : "hidden");
      if (p) { markers[k].setAttribute("cx", x(i)); markers[k].setAttribute("cy", y(p.median)); }
      rows.push({ series: s, value: p ? formatPrice(p.median, unit) : "No data", label: `${s.label}${p ? ` · ${formatCount(p.n)} stations` : ""}`, v: p?.median ?? -Infinity });
    });
    rows.sort((a, b) => b.v - a.v);
    const p = series[0].points[i];
    if (showBand && p) rows.push({ value: `${formatEuro(p.p10)} – ${formatEuro(p.p90)}`, label: "P10–P90 (80% of stations)" });
    const hint = i === selected ? "Selected day · Esc returns to latest" : touchArmed === i ? "Tap again to inspect this day" : "Click to inspect this day";
    showTip(cx, cy, `${formatWeekday(dates[i])} · median`, rows, hint);
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    for (const m of markers) m.setAttribute("visibility", "hidden");
    hideTip();
  };
  const indexAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    const i = dates.length === 1 ? 0 : Math.round(((vx - L) / (W - L - R)) * (dates.length - 1));
    return Math.min(dates.length - 1, Math.max(0, i));
  };
  overlay.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(indexAt(e.clientX), e.clientX, e.clientY); });
  overlay.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  overlay.addEventListener("pointerup", (e) => {
    const i = indexAt(e.clientX);
    if (e.pointerType !== "mouse" && touchArmed !== i) { touchArmed = i; show(i, e.clientX, e.clientY); return; }
    touchArmed = null;
    hide();
    onSelectDay(i);
  });
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? dates.length - 1 : Math.min(dates.length - 1, Math.max(0, current + moves[e.key]));
      const r = svg.getBoundingClientRect();
      show(next, r.left + (x(next) / W) * r.width, r.top + 30);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectDay(current);
    } else if (e.key === "Escape") {
      onSelectDay(null);
    }
  });
  container.replaceChildren(svg);
}

// ---------- comparison: median dot on a min–max line, one row per group ----------
export function renderDotRange(container, { rows, unit, selectedKey, onSelect, reference, referenceLabel, actionHint }) {
  if (rows.length === 0) {
    container.replaceChildren(emptyNode("No published prices for these filters on this day."));
    return;
  }
  const W = widthOf(container, 520), row = 28, T = 26, B = 24;
  const L = Math.min(170, Math.round(W * 0.36)), R = 66;
  const H = T + rows.length * row + B;
  const lo = Math.min(...rows.map((g) => g.min)), hi = Math.max(...rows.map((g) => g.max));
  const pad = Math.max((hi - lo) * 0.05, 5);
  const v0 = lo - pad, v1 = hi + pad;
  const x = (v) => L + ((v - v0) * (W - L - R)) / (v1 - v0);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fm-dots", role: "group", "aria-label": "Median and minimum–maximum price per group" });
  for (const t of ticks(v0, v1, 3)) {
    el("line", { class: "grid", x1: x(t), x2: x(t), y1: T - 4, y2: H - B }, svg);
    text(svg, x(t), H - B + 16, formatAxis(t), { "text-anchor": "middle", class: "tick" });
  }
  if (reference !== null && reference !== undefined) {
    el("line", { class: "ref", x1: x(reference), x2: x(reference), y1: T - 6, y2: H - B }, svg);
    text(svg, x(reference), T - 10, `${referenceLabel} ${formatEuro(reference)}`, { "text-anchor": "middle", class: "ref-label" });
  }
  const maxChars = Math.max(8, Math.floor(L / 7.2));
  const selectable = typeof onSelect === "function";
  rows.forEach((g, k) => {
    const cy = T + k * row + row / 2;
    const isSel = g.key === selectedKey;
    const hit = el("rect", { class: `row-hit${selectable ? "" : " static"}${isSel ? " selected" : ""}`, x: 0, y: cy - row / 2 + 1, width: W, height: row - 2, rx: 6,
      "data-fk": `grp-${g.key}`, ...(selectable ? { tabindex: 0, role: "button", "aria-pressed": String(isSel) } : { "aria-hidden": "true" }),
      "aria-label": `${g.label}: median ${formatPrice(g.median, unit)}, ${g.n} stations.${selectable ? ` ${isSel ? "Selected. Press to clear." : actionHint}` : ""}` }, svg);
    text(svg, L - 10, cy + 4, g.label.length > maxChars ? `${g.label.slice(0, maxChars - 1)}…` : g.label, { "text-anchor": "end", class: `row-label${isSel ? " sel" : ""}` });
    el("line", { class: "range", x1: x(g.min), x2: x(g.max), y1: cy, y2: cy }, svg);
    el("line", { class: "iqr", x1: x(g.p10), x2: x(g.p90), y1: cy, y2: cy }, svg);
    el("circle", { class: `dot${isSel ? " sel" : ""}`, cx: x(g.median), cy, r: 5 }, svg);
    text(svg, W - R + 8, cy + 4, formatEuro(g.median), { class: "row-value" });
    const tip = (cx, cy2) => showTip(cx, cy2, g.label, [
      { value: formatPrice(g.median, unit), label: "median" },
      { value: `${formatEuro(g.p10)} – ${formatEuro(g.p90)}`, label: "P10–P90" },
      { value: `${formatEuro(g.min)} – ${formatEuro(g.max)}`, label: "min – max" },
      { value: formatCount(g.n), label: "stations" },
    ], selectable ? (isSel ? "Click to clear this filter" : actionHint) : "");
    hit.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") tip(e.clientX, e.clientY); });
    hit.addEventListener("pointerleave", hideTip);
    hit.addEventListener("focus", () => { if (!hit.matches(":focus-visible")) return; const [ax, ay] = anchor(hit); tip(ax, ay + 16); });
    hit.addEventListener("blur", hideTip);
    if (selectable) {
      const go = () => { hideTip(); onSelect(isSel ? null : g.key); };
      hit.addEventListener("click", go);
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    }
  });
  container.replaceChildren(svg);
}

// ---------- map: one dot per station, five equal-count price bands, nearest-station hit testing ----------
export function renderMap(container, { points, unit, selectedCode, onSelect, maxHeight = 560 }) {
  if (points.length === 0) {
    container.replaceChildren(emptyNode("No stations with a price and location for these filters."));
    return { bins: [], highlight: () => {} };
  }
  const bins = priceBins(points.map((p) => p.price));
  const band = (price) => bins.findIndex((b) => price <= b.max) + 1 || bins.length;
  let latMin = Math.min(...points.map((p) => p.station.lat)), latMax = Math.max(...points.map((p) => p.station.lat));
  let lonMin = Math.min(...points.map((p) => p.station.lon)), lonMax = Math.max(...points.map((p) => p.station.lon));
  const minSpan = 0.05;
  if (latMax - latMin < minSpan) { latMin -= minSpan / 2; latMax += minSpan / 2; }
  if (lonMax - lonMin < minSpan) { lonMin -= minSpan / 2; lonMax += minSpan / 2; }
  const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
  const W = widthOf(container, 360), P = 12;
  const scale = (W - 2 * P) / ((lonMax - lonMin) * kx);
  const H = Math.min(maxHeight, Math.max(220, (latMax - latMin) * scale + 2 * P));
  const s = Math.min(scale, (H - 2 * P) / (latMax - latMin));
  const offX = (W - 2 * P - (lonMax - lonMin) * kx * s) / 2;
  const px = (lon) => P + (lon - lonMin) * kx * s + offX;
  const py = (lat) => P + (latMax - lat) * s;
  const r = points.length > 1500 ? 2.6 : points.length > 300 ? 3.4 : 5;

  const ordered = [...points].sort((a, b) => a.price - b.price); // dearest drawn last; also the keyboard order (cheapest first)
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "fm-map", role: "application", tabindex: 0, "data-fk": "map",
    "aria-label": `Map of ${points.length} stations coloured by price band. Arrow keys step through stations from cheapest to dearest; Enter opens the station.` });
  const xy = ordered.map((p) => [px(p.station.lon), py(p.station.lat)]);
  ordered.forEach((p, k) => {
    el("circle", { cx: xy[k][0].toFixed(1), cy: xy[k][1].toFixed(1), r, class: `q${band(p.price)}` }, svg);
  });
  const hoverRing = el("circle", { class: "hover-ring", r: r + 4, visibility: "hidden" }, svg);
  const linkRing = el("circle", { class: "link-ring", r: r + 5, visibility: "hidden" }, svg);
  const selIdx = ordered.findIndex((p) => p.station.code === selectedCode);
  if (selIdx !== -1) el("circle", { class: "sel-ring", cx: xy[selIdx][0], cy: xy[selIdx][1], r: r + 4 }, svg);

  let cursor = selIdx === -1 ? 0 : selIdx;
  const tipFor = (k, cx, cy) => {
    const p = ordered[k];
    hoverRing.setAttribute("cx", xy[k][0]);
    hoverRing.setAttribute("cy", xy[k][1]);
    hoverRing.setAttribute("visibility", "visible");
    showTip(cx, cy, p.station.name, [
      { value: formatPrice(p.price, unit), label: `${k + 1} of ${points.length} by price` },
      { value: p.station.brand, label: `${p.station.municipality} · ${p.station.district}` },
    ], "Click for station details");
  };
  const nearest = (e) => {
    const box = svg.getBoundingClientRect();
    const k = W / box.width;
    const vx = (e.clientX - box.left) * k, vy = (e.clientY - box.top) * k;
    let best = -1, bestD = (HIT_RADIUS_PX * k) ** 2;
    for (let i = 0; i < xy.length; i++) {
      const d = (xy[i][0] - vx) ** 2 + (xy[i][1] - vy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  svg.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const k = nearest(e);
    if (k === -1) { hoverRing.setAttribute("visibility", "hidden"); hideTip(); svg.style.cursor = "default"; return; }
    svg.style.cursor = "pointer";
    tipFor(k, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", () => { hoverRing.setAttribute("visibility", "hidden"); hideTip(); });
  svg.addEventListener("click", (e) => {
    const k = nearest(e);
    if (k !== -1) { hideTip(); onSelect(ordered[k].station.code); }
  });
  svg.addEventListener("blur", () => { hoverRing.setAttribute("visibility", "hidden"); hideTip(); });
  svg.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      cursor = (cursor + step + ordered.length) % ordered.length;
      const box = svg.getBoundingClientRect();
      tipFor(cursor, box.left + (xy[cursor][0] / W) * box.width, box.top + (xy[cursor][1] / W) * box.width);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      hideTip();
      onSelect(ordered[cursor].station.code);
    }
  });
  container.replaceChildren(svg);
  return {
    bins,
    /** Ring one station without redrawing (linked hover from the table). */
    highlight(code) {
      const k = code === null ? -1 : ordered.findIndex((p) => p.station.code === code);
      linkRing.setAttribute("visibility", k === -1 ? "hidden" : "visible");
      if (k !== -1) { linkRing.setAttribute("cx", xy[k][0]); linkRing.setAttribute("cy", xy[k][1]); }
    },
  };
}

export function mapLegend(bins, unit) {
  const box = document.createElement("div");
  box.className = "fm-legend";
  bins.forEach((b, i) => {
    const item = document.createElement("span");
    const sw = document.createElement("i");
    sw.className = `fm-swatch q${i + 1}`;
    item.append(sw, `${formatEuro(b.min)}–${formatEuro(b.max)}`);
    box.appendChild(item);
  });
  const note = document.createElement("span");
  note.className = "fm-legend-note";
  note.textContent = `per ${unit === "litro" ? "litre" : unit} · each colour ≈ 1/5 of stations`;
  box.appendChild(note);
  return box;
}

// ---------- sparkline (KPI cards: decorative; station detail: with hover) ----------
export function renderSpark(container, { values, dates, unit, selected = null, interactive = false, height = 36, family = "", premium = false }) {
  const pts = values.map((v, i) => (v === null || v === undefined ? null : { i, v })).filter(Boolean);
  if (pts.length === 0) { container.replaceChildren(...(interactive ? [emptyNode("No published history.")] : [])); return; }
  const W = widthOf(container, 160), H = height, P = 4;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (i) => (values.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (values.length - 1));
  const y = (v) => (hi === lo ? H / 2 : P + ((hi - v) * (H - 2 * P)) / (hi - lo));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: `fm-spark fam-${family}${premium ? " premium" : ""}`,
    ...(interactive ? { role: "img", "aria-label": `History from ${formatPrice(pts[0].v, unit)} to ${formatPrice(pts[pts.length - 1].v, unit)}` } : { "aria-hidden": "true" }) });
  if (selected !== null && values[selected] !== null && values[selected] !== undefined) {
    el("line", { class: "spark-sel", x1: x(selected), x2: x(selected), y1: 0, y2: H }, svg);
  }
  if (pts.length > 1) el("polyline", { class: "line", points: pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ") }, svg);
  const last = pts[pts.length - 1];
  el("circle", { class: "pt", cx: x(last.i), cy: y(last.v), r: 2.6 }, svg);
  if (interactive) {
    for (const p of pts) {
      const hit = el("circle", { class: "spark-hit", cx: x(p.i), cy: y(p.v), r: 9 }, svg);
      hit.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, formatWeekday(dates[p.i]), [{ value: formatPrice(p.v, unit), label: "published price" }]));
      hit.addEventListener("pointerleave", hideTip);
    }
  }
  container.replaceChildren(svg);
}
