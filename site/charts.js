// SVG charts drawn by hand (no library, no third-party requests). Text is always set with textContent.
import { formatDate, formatPrice } from "./lib.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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

function empty(container, message) {
  container.replaceChildren();
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = message;
  container.appendChild(p);
}

/** Drawing width in px: the container's own width, so text keeps its real size (the app redraws on resize). */
function widthOf(container, fallback) {
  return Math.max(280, Math.round(container.clientWidth || fallback));
}

/** Up to `count` round ticks covering [lo, hi] (values in milli-euro). */
function ticks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

// ---------- tooltip ----------
const tooltip = () => document.getElementById("tooltip");

export function showTooltip(x, y, title, lines) {
  const tip = tooltip();
  tip.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = title;
  tip.appendChild(strong);
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    tip.appendChild(span);
  }
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - width - 8);
  const top = y + 14 + height > window.innerHeight ? y - height - 14 : y + 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

export function hideTooltip() {
  tooltip().hidden = true;
}

function anchorOf(node) {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top];
}

// ---------- daily evolution: median line + P10–P90 band ----------
export function renderTrend(container, { dates, series, unit }) {
  const points = series.map((s, i) => (s ? { i, ...s } : null));
  const present = points.filter(Boolean);
  if (present.length === 0) {
    empty(container, "Sem preços publicados para estes filtros neste período.");
    return;
  }
  const W = widthOf(container, 760), H = 260, L = 64, R = 16, T = 12, B = 30;
  const lo = Math.min(...present.map((p) => p.p10));
  const hi = Math.max(...present.map((p) => p.p90));
  const pad = Math.max((hi - lo) * 0.08, 5);
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i) => (dates.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (dates.length - 1));
  const y = (v) => T + ((y1 - v) * (H - T - B)) / (y1 - y0);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0,
    "aria-label": `Mediana diária e faixa P10–P90 entre ${formatDate(dates[0])} e ${formatDate(dates[dates.length - 1])}. Use as setas para percorrer os dias.` });
  for (const t of ticks(y0, y1)) {
    el("line", { class: "grid", x1: L, x2: W - R, y1: y(t), y2: y(t) }, svg);
    text(svg, L - 8, y(t) + 4, formatPrice(t, unit).replace(/ €.*/, " €"), { "text-anchor": "end" });
  }
  el("line", { class: "axis", x1: L, x2: W - R, y1: H - B, y2: H - B }, svg);
  const every = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(W / 80))));
  dates.forEach((d, i) => {
    if (i % every === 0 || i === dates.length - 1) text(svg, x(i), H - B + 18, formatDate(d).slice(0, 5), { "text-anchor": "middle" });
  });

  // contiguous runs of days with data: a missing day breaks the line instead of being drawn as 0
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    if (r.length > 1) {
      const upper = r.map((p) => `${x(p.i)},${y(p.p90)}`);
      const lower = [...r].reverse().map((p) => `${x(p.i)},${y(p.p10)}`);
      el("polygon", { class: "band", points: [...upper, ...lower].join(" ") }, svg);
      el("polyline", { class: "line", points: r.map((p) => `${x(p.i)},${y(p.median)}`).join(" ") }, svg);
    } else {
      el("circle", { class: "dot", cx: x(r[0].i), cy: y(r[0].median), r: 4 }, svg);
    }
  }

  const cross = el("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" }, svg);
  const marker = el("circle", { class: "dot", r: 4.5, visibility: "hidden" }, svg);
  const overlay = el("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
  let current = present[present.length - 1].i;

  const show = (i, clientX, clientY) => {
    const p = points[i];
    current = i;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    if (!p) {
      marker.setAttribute("visibility", "hidden");
      showTooltip(clientX, clientY, formatDate(dates[i]), ["Sem preços publicados neste dia"]);
      return;
    }
    marker.setAttribute("cx", x(i));
    marker.setAttribute("cy", y(p.median));
    marker.setAttribute("visibility", "visible");
    showTooltip(clientX, clientY, formatDate(dates[i]), [
      `Mediana ${formatPrice(p.median, unit)}`,
      `P10–P90 ${formatPrice(p.p10, unit)} – ${formatPrice(p.p90, unit)}`,
      `${p.n} postos`,
    ]);
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    marker.setAttribute("visibility", "hidden");
    hideTooltip();
  };
  overlay.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    const i = dates.length === 1 ? 0 : Math.round(((vx - L) / (W - L - R)) * (dates.length - 1));
    show(Math.min(dates.length - 1, Math.max(0, i)), e.clientX, e.clientY);
  });
  overlay.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = Math.min(dates.length - 1, Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1)));
    const [ax, ay] = anchorOf(svg);
    show(next, ax, ay + 40);
  });
  container.replaceChildren(svg);
}

// ---------- regions: dot (median) on a min–max range, one row per area ----------
export function renderAreas(container, { groups, unit, selected, onSelect }) {
  if (groups.length === 0) {
    empty(container, "Sem preços publicados para estes filtros no último dia.");
    return;
  }
  const W = widthOf(container, 520), L = Math.min(150, W * 0.36), R = 56, row = 26, T = 8, B = 26;
  const H = T + groups.length * row + B;
  const lo = Math.min(...groups.map((g) => g.min));
  const hi = Math.max(...groups.map((g) => g.max));
  const pad = Math.max((hi - lo) * 0.05, 5);
  const v0 = lo - pad, v1 = hi + pad;
  const x = (v) => L + ((v - v0) * (W - L - R)) / (v1 - v0);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Mediana e intervalo mínimo–máximo por região" });
  for (const t of ticks(v0, v1, 3)) {
    el("line", { class: "grid", x1: x(t), x2: x(t), y1: T, y2: H - B }, svg);
    text(svg, x(t), H - B + 16, formatPrice(t, unit).replace(/ €.*/, ""), { "text-anchor": "middle" });
  }
  const maxChars = Math.max(8, Math.floor(L / 7));
  groups.forEach((g, k) => {
    const cy = T + k * row + row / 2;
    const selectable = typeof onSelect === "function";
    const label = `${g.key}: mediana ${formatPrice(g.median, unit)}, ${g.n} postos.${selectable ? " Filtrar." : ""}`;
    const hit = el("rect", { class: `row-hit${selectable ? "" : " static"}${g.key === selected ? " row-selected" : ""}`, x: 0, y: cy - row / 2,
      width: W, height: row, rx: 4, tabindex: 0, ...(selectable ? { role: "button" } : {}), "aria-label": label }, svg);
    text(svg, L - 10, cy + 4, g.key.length > maxChars ? `${g.key.slice(0, maxChars - 1)}…` : g.key, { "text-anchor": "end", class: "label" });
    el("line", { class: "range", x1: x(g.min), x2: x(g.max), y1: cy, y2: cy }, svg);
    el("circle", { class: "dot", cx: x(g.median), cy, r: 5 }, svg);
    text(svg, W - R + 6, cy + 4, `${g.n}`, { "text-anchor": "start" });
    const tip = (e) => showTooltip(e.clientX ?? anchorOf(hit)[0], e.clientY ?? anchorOf(hit)[1], g.key, [
      `Mediana ${formatPrice(g.median, unit)}`,
      `Mín. ${formatPrice(g.min, unit)} · Máx. ${formatPrice(g.max, unit)}`,
      `${g.n} postos`,
    ]);
    hit.addEventListener("pointermove", tip);
    hit.addEventListener("pointerleave", hideTooltip);
    hit.addEventListener("focus", () => { const [ax, ay] = anchorOf(hit); tip({ clientX: ax, clientY: ay }); });
    hit.addEventListener("blur", hideTooltip);
    if (selectable) {
      hit.addEventListener("click", () => onSelect(g.key));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.key); } });
    }
  });
  text(svg, W - R + 6, H - B + 16, "postos", { "text-anchor": "start" });
  container.replaceChildren(svg);
}

// ---------- map: one dot per station, coloured by price band ----------
export function renderMap(container, { points, bins, unit, selectedCode, onSelect }) {
  const located = points.filter((p) => p.station.lat !== null && p.station.lon !== null);
  if (located.length === 0) {
    empty(container, "Sem postos com preço e localização para estes filtros.");
    return;
  }
  const lats = located.map((p) => p.station.lat);
  const lons = located.map((p) => p.station.lon);
  let latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const minSpan = 0.05; // a single municipality can be tiny: keep some context around it
  if (latMax - latMin < minSpan) { latMin -= minSpan / 2; latMax += minSpan / 2; }
  if (lonMax - lonMin < minSpan) { lonMin -= minSpan / 2; lonMax += minSpan / 2; }
  const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180); // equirectangular, corrected at mid-latitude
  const W = widthOf(container, 360), P = 10;
  const scale = (W - 2 * P) / ((lonMax - lonMin) * kx);
  const H = Math.min(560, Math.max(200, (latMax - latMin) * scale + 2 * P));
  const s = Math.min(scale, (H - 2 * P) / (latMax - latMin));
  const x = (lon) => P + (lon - lonMin) * kx * s + (W - 2 * P - (lonMax - lonMin) * kx * s) / 2;
  const y = (lat) => P + (latMax - lat) * s;
  const r = located.length > 1500 ? 2.6 : located.length > 300 ? 3.5 : 5;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Mapa com ${located.length} postos coloridos por escalão de preço. A tabela de postos abaixo tem os mesmos dados.` });
  // dearest last so they stay visible on top
  const ordered = [...located].sort((a, b) => a.price - b.price);
  for (const p of ordered) {
    const band = bins.findIndex((b) => p.price <= b.max) + 1 || bins.length;
    const c = el("circle", { cx: x(p.station.lon).toFixed(1), cy: y(p.station.lat).toFixed(1), r,
      class: `s${band}${p.station.code === selectedCode ? " selected" : ""}` }, svg);
    c.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, p.station.name, [
      formatPrice(p.price, unit), `${p.station.brand} · ${p.station.municipality}`,
    ]));
    c.addEventListener("pointerleave", hideTooltip);
    c.addEventListener("click", () => onSelect(p.station.code));
  }
  container.replaceChildren(svg);
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

/** Small inline history chart for one station x fuel (published days only). */
export function renderSparkline(container, { dates, prices, unit }) {
  const pts = prices.map((v, i) => (v === null ? null : { i, v })).filter(Boolean);
  if (pts.length === 0) { empty(container, "Sem histórico publicado."); return; }
  const W = widthOf(container, 320), H = 70, P = 8;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (i) => (dates.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (dates.length - 1));
  const y = (v) => (hi === lo ? H / 2 : P + ((hi - v) * (H - 2 * P - 14)) / (hi - lo));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Histórico: de ${formatPrice(pts[0].v, unit)} a ${formatPrice(pts[pts.length - 1].v, unit)}` });
  if (pts.length > 1) el("polyline", { class: "line", points: pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ") }, svg);
  for (const p of pts) el("circle", { class: "dot", cx: x(p.i), cy: y(p.v), r: 3 }, svg);
  text(svg, P, H - 2, formatDate(dates[0]).slice(0, 5));
  text(svg, W - P, H - 2, formatDate(dates[dates.length - 1]).slice(0, 5), { "text-anchor": "end" });
  const wrap = document.createElement("div");
  wrap.className = "chart";
  wrap.appendChild(svg);
  container.replaceChildren(wrap);
}
