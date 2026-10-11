// Dashboard UI pieces: filters, active-filter chips, history banner, station table, station detail, series legend.
// Data text is always inserted with textContent (never innerHTML).
import { emptyNode, hideTip, renderSpark } from "./charts.js";
import { formatCount, formatDate, formatDelta, formatLisbon, formatPrice, formatUtc, staleDays } from "./lib.js";
import { RESET_PATCH, areaLabel, brandLabel, typeLabel } from "./model.js";

export const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 150;
const STALE_AFTER_DAYS = 2;

export function h(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

// ---------- filters ----------
export function filterOptions(data, state) {
  return {
    fuel: data.fuels.map((f) => ({ value: String(f.id), label: f.label, group: f.fleet ? "Common road fuels" : "Other fuels" })),
    district: [{ value: "", label: "All of mainland Portugal" }, ...data.districts.map((d) => ({ value: d, label: d }))],
    municipality: [{ value: "", label: state.district ? "All municipalities" : "Choose a district first" },
      ...(state.district ? data.municipalities(state.district).map((m) => ({ value: m, label: m })) : [])],
    brand: [{ value: "", label: "All brands" }, ...data.brands.map((b) => ({ value: b.value, label: `${b.label} · ${formatCount(b.n)}` }))],
    type: [{ value: "", label: "All station types" }, ...data.types.map((t) => ({ value: t.value, label: t.label }))],
    range: data.rangeOptions(),
  };
}

export function fillSelect(select, options, value) {
  const groups = new Map();
  const flat = [];
  for (const o of options) {
    const opt = h("option", { value: o.value, text: o.label, disabled: o.disabled, title: o.hint || undefined });
    if (o.group) {
      if (!groups.has(o.group)) groups.set(o.group, h("optgroup", { label: o.group }));
      groups.get(o.group).append(opt);
    } else flat.push(opt);
  }
  select.replaceChildren(...flat, ...groups.values());
  select.value = value;
}

/** Wire the standard selects (ids f-fuel, f-district, f-municipality, f-brand, f-type, f-range) to the store. */
export function bindFilters(root, data, store) {
  const on = (id, fn) => root.querySelector(`#${id}`)?.addEventListener("change", (e) => fn(e.target.value));
  on("f-fuel", (v) => selectFuel(data, store, Number(v)));
  on("f-district", (v) => store.set({ district: v, station: null }));
  on("f-municipality", (v) => store.set({ municipality: v, station: null }));
  on("f-brand", (v) => store.set({ brand: v, station: null }));
  on("f-type", (v) => store.set({ type: v, station: null }));
  on("f-range", (v) => store.set({ range: v }));
  root.addEventListener("range", (e) => store.set({ range: e.detail }));
}

export function syncFilters(root, data, state) {
  const opts = filterOptions(data, state);
  const set = (id, options, value) => { const s = root.querySelector(`#${id}`); if (s) fillSelect(s, options, value); };
  set("f-fuel", opts.fuel, String(state.fuel));
  set("f-district", opts.district, state.district);
  set("f-municipality", opts.municipality, state.municipality);
  set("f-brand", opts.brand, state.brand);
  set("f-type", opts.type, state.type);
  set("f-range", opts.range, state.range);
  const muni = root.querySelector("#f-municipality");
  if (muni) muni.disabled = !state.district;
  const seg = root.querySelector("[data-range-segmented]");
  if (seg) {
    seg.replaceChildren(...opts.range.map((o) => h("label", { class: `fm-seg${o.disabled ? " disabled" : ""}`, title: o.hint || undefined }, [
      h("input", { type: "radio", name: "f-range", "data-fk": `range-${o.value}`, value: o.value, checked: o.value === state.range, disabled: o.disabled,
        onchange: (e) => seg.dispatchEvent(new CustomEvent("range", { detail: e.target.value, bubbles: true })) }),
      h("span", { text: o.label }),
    ])));
  }
}

/** Compare mode for a fuel: every fleet fuel sold in the same unit plus the fuel itself; a readable default set is
 *  visible, the rest one click away. Units are never mixed on one axis. */
export function compareSet(data, fuelId) {
  const unit = data.fuelById.get(fuelId).unit;
  const ids = data.fleet.filter((f) => f.unit === unit).map((f) => f.id);
  if (!ids.includes(fuelId)) ids.unshift(fuelId);
  const visibleByDefault = new Set([fuelId, ...data.fleet.filter((f) => ["Diesel", "Petrol 95", "Petrol 98"].includes(f.label)).map((f) => f.id)]);
  return { compare: ids, hidden: ids.filter((id) => !visibleByDefault.has(id)) };
}

/** Select a fuel; in compare mode the compared set follows its unit, keeping visibility choices where they still apply. */
export function selectFuel(data, store, fuelId) {
  const s = store.get();
  if (!s.compare.length) { store.set({ fuel: fuelId }); return; }
  const next = compareSet(data, fuelId);
  const kept = s.compare.filter((id) => next.compare.includes(id));
  const hidden = next.compare.filter((id) => id !== fuelId && (kept.includes(id) ? s.hidden.includes(id) : next.hidden.includes(id)));
  store.set({ fuel: fuelId, compare: next.compare, hidden });
}

export function toggleCompare(data, store, on) {
  store.set(on ? compareSet(data, store.get().fuel) : { compare: [], hidden: [] });
}

export function trendSeries(data, state) {
  const ids = state.compare.length ? state.compare.filter((id) => !state.hidden.includes(id)) : [state.fuel];
  const t = data.trend(state, ids);
  return {
    ...t,
    series: t.series.map((s) => ({ ...s.fuel, points: s.points, focus: state.compare.length > 0 && s.fuel.id === state.fuel })),
    selected: state.day === null ? null : state.day - t.start,
  };
}

export function renderLegend(container, data, state, store) {
  if (!state.compare.length) { container.replaceChildren(); return; }
  container.replaceChildren(...state.compare.map((id) => {
    const f = data.fuelById.get(id);
    const shown = !state.hidden.includes(id);
    return h("button", { type: "button", "data-fk": `legend-${id}`, class: `fm-legend-btn fam-${f.family}${f.premium ? " premium" : ""}`, "aria-pressed": String(shown),
      title: f.label === "LPG (Autogas)" ? "LPG costs about half as much; showing it widens the scale" : `Show or hide ${f.label}`,
      onclick: () => store.set({ hidden: shown ? [...state.hidden, id] : state.hidden.filter((x) => x !== id) }) },
    [h("i", { class: "fm-key", "aria-hidden": "true" }), h("span", { text: f.label })]);
  }));
}

// ---------- active filters ----------
export function activeFilters(data, state) {
  const out = [];
  if (state.district) out.push({ label: `District: ${state.district}`, patch: { district: "" } });
  if (state.municipality) out.push({ label: `Municipality: ${state.municipality}`, patch: { municipality: "" } });
  if (state.brand) out.push({ label: `Brand: ${brandLabel(state.brand)}`, patch: { brand: "" } });
  if (state.type) out.push({ label: `Type: ${typeLabel(state.type)}`, patch: { type: "" } });
  if (state.range !== "all") out.push({ label: `Chart: last ${state.range} days`, patch: { range: "all" } });
  if (!data.isLatest(state)) out.push({ label: `Viewing ${formatDate(data.dates[state.day])}`, patch: { day: null }, historical: true });
  if (state.search.trim()) out.push({ label: `Search: “${state.search.trim()}”`, patch: { search: "" } });
  return out;
}

export function renderChips(container, data, state, store, { emptyText = "No filters applied · showing all of mainland Portugal" } = {}) {
  const active = activeFilters(data, state);
  if (active.length === 0) {
    container.replaceChildren(h("span", { class: "fm-chips-empty", text: emptyText }));
    return;
  }
  container.replaceChildren(
    ...active.map((a, i) => h("button", { type: "button", "data-fk": `chip-${i}`, class: `fm-chip${a.historical ? " historical" : ""}`, "aria-label": `Remove filter ${a.label}`,
      onclick: () => store.set(a.patch) }, [h("span", { text: a.label }), h("span", { class: "x", "aria-hidden": "true", text: "✕" })])),
    h("button", { type: "button", class: "fm-reset", "data-fk": "chip-reset", text: "Reset all", onclick: () => store.set(RESET_PATCH) }),
  );
}

// ---------- freshness and historical inspection ----------
export function freshness(data) {
  const late = staleDays(data.coverage.latest_date);
  return {
    latest: formatDate(data.coverage.latest_date),
    generated: formatUtc(data.generatedAt),
    days: data.coverage.n_days,
    since: formatDate(data.coverage.first_date),
    stale: late > STALE_AFTER_DAYS,
    staleText: `The latest data is ${late} days old. The daily collection may have failed; prices may not reflect today.`,
  };
}

export function renderHistoryBanner(container, data, state, store) {
  if (data.isLatest(state)) { container.hidden = true; container.replaceChildren(); return; }
  container.hidden = false;
  container.replaceChildren(
    h("div", { class: "fm-hist-text" }, [
      h("strong", { text: `Historical view · ${formatDate(data.dates[state.day])}` }),
      h("span", { text: ` Cards, comparison, map and table show prices published that day. Latest data: ${formatDate(data.coverage.latest_date)}.` }),
    ]),
    h("button", { type: "button", class: "fm-btn", text: "Back to latest", onclick: () => store.set({ day: null }) }),
  );
}

// ---------- search ----------
export function bindSearch(input, store) {
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => store.set({ search: input.value }), SEARCH_DEBOUNCE_MS);
  });
}

// ---------- station table ----------
const COLUMNS = [
  { key: "name", label: "Station" },
  { key: "brand", label: "Brand", hideNarrow: true },
  { key: "place", label: "Location" },
  { key: "type", label: "Type", hideNarrow: true },
  { key: "price", label: "Price", num: true },
  { key: "vsMedian", label: "vs median", num: true, title: "Difference from the median of all stations in the current filters" },
  { key: "updated", label: "Updated (DGEG)", hideNarrow: true, title: "Time of the station's last update in DGEG, Lisbon time. Latest day only." },
];

export function renderStationTable(container, data, state, store, { pageSize = PAGE_SIZE, onHover = null, onOpen = null } = {}) {
  const fuel = data.fuelById.get(state.fuel);
  const rows = data.stationRows(state);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(state.page, pages - 1);
  const slice = rows.slice(page * pageSize, (page + 1) * pageSize);
  const latest = data.isLatest(state);
  const open = (code) => { store.set({ station: code }); onOpen?.(code); };

  const head = h("tr", {}, COLUMNS.map((c) => {
    const sorted = state.sort.key === c.key;
    const disabled = c.key === "updated" && !latest;
    return h("th", { scope: "col", class: [c.num ? "num" : "", c.hideNarrow ? "hide-narrow" : ""].join(" "), "aria-sort": sorted ? (state.sort.dir === 1 ? "ascending" : "descending") : undefined, title: c.title },
      [h("button", { type: "button", class: "fm-sort", "data-fk": `sort-${c.key}`, disabled,
        onclick: () => store.set({ sort: { key: c.key, dir: sorted ? -state.sort.dir : 1 }, page: 0 }) },
      [h("span", { text: c.label }), h("span", { class: "ind", "aria-hidden": "true", text: sorted ? (state.sort.dir === 1 ? "↑" : "↓") : "↕" })])]);
  }));

  const body = slice.length === 0
    ? [h("tr", {}, [h("td", { colspan: COLUMNS.length }, [emptyNode(state.search.trim() ? `No station matches “${state.search.trim()}” with these filters.` : "No station published a price for these filters on this day.",
      [{ label: "Reset all filters", onClick: () => store.set(RESET_PATCH) }])])])]
    : slice.map((r) => {
      const dir = r.vsMedian === null ? "" : r.vsMedian > 0 ? "up" : r.vsMedian < 0 ? "down" : "flat";
      const tr = h("tr", { class: `${r.station.code === state.station ? "selected" : ""}`, onclick: (e) => { if (!e.target.closest("button")) open(r.station.code); } }, [
        h("td", {}, [h("button", { type: "button", "data-fk": `st-${r.station.code}`, class: "fm-station-link", title: r.station.name, text: r.station.name, onclick: () => open(r.station.code) }),
          h("span", { class: "sub show-narrow", text: brandLabel(r.station.brand) })]),
        h("td", { class: "hide-narrow", text: brandLabel(r.station.brand) }),
        h("td", { title: r.station.address ?? "" }, [h("span", { text: r.station.municipality }), h("span", { class: "sub", text: r.station.locality ?? "" })]),
        h("td", { class: "hide-narrow", text: typeLabel(r.station.type) }),
        h("td", { class: "num price", text: formatPrice(r.price, fuel.unit) }),
        h("td", { class: `num delta ${dir}`, text: r.vsMedian === null ? "–" : r.vsMedian === 0 ? "at median" : formatDelta(r.vsMedian) }),
        h("td", { class: "hide-narrow", text: latest ? formatLisbon(r.updatedAt) : "–", title: latest ? undefined : "DGEG update times are only kept for the latest price" }),
      ]);
      if (onHover) {
        tr.addEventListener("pointerenter", () => onHover(r.station.code));
        tr.addEventListener("pointerleave", () => onHover(null));
        tr.addEventListener("focusin", () => onHover(r.station.code));
        tr.addEventListener("focusout", () => onHover(null));
      }
      return tr;
    });

  const from = rows.length ? page * pageSize + 1 : 0;
  const to = Math.min(rows.length, (page + 1) * pageSize);
  container.replaceChildren(
    h("div", { class: "fm-table-wrap" }, [h("table", { class: "fm-table" }, [h("thead", {}, [head]), h("tbody", {}, body)])]),
    h("nav", { class: "fm-pager", "aria-label": "Station table pages" }, [
      h("span", { class: "fm-pager-count", text: `${formatCount(from)}–${formatCount(to)} of ${formatCount(rows.length)} stations` }),
      h("button", { type: "button", class: "fm-btn ghost", "data-fk": "pager-prev", text: "← Previous", disabled: page === 0, onclick: () => store.set({ page: page - 1 }) }),
      h("span", { class: "fm-pager-page", text: `Page ${page + 1} of ${formatCount(pages)}` }),
      h("button", { type: "button", class: "fm-btn ghost", "data-fk": "pager-next", text: "Next →", disabled: page >= pages - 1, onclick: () => store.set({ page: page + 1 }) }),
    ]),
  );
  return rows.length;
}

// ---------- station detail ----------
export function renderStationDetail(container, data, state, store, { onClose } = {}) {
  const d = state.station === null ? null : data.stationDetail(state, state.station);
  if (!d) { container.replaceChildren(); return false; }
  const fuel = data.fuelById.get(state.fuel);
  const s = d.station;
  const current = d.rows.find((r) => r.fuel.id === state.fuel);
  let compare = null;
  if (current && current.price !== null && d.districtMedian !== null) {
    const diff = current.price - d.districtMedian;
    compare = diff === 0 ? `At the ${s.district} median for ${fuel.label}.`
      : `${formatDelta(Math.abs(diff)).slice(1)} ${diff > 0 ? "above" : "below"} the ${s.district} median for ${fuel.label} (${formatPrice(d.districtMedian, fuel.unit)}).`;
  }
  const spark = h("div", { class: "fm-detail-spark" });
  const close = () => { hideTip(); if (onClose) onClose(); else store.set({ station: null }); };
  container.replaceChildren(
    h("div", { class: "fm-detail-head" }, [
      h("div", {}, [h("h3", { text: s.name }), h("p", { class: "fm-detail-meta", text: `${brandLabel(s.brand)} · ${typeLabel(s.type)}` })]),
      h("button", { type: "button", class: "fm-icon-btn", "aria-label": "Close station details", text: "✕", onclick: close }),
    ]),
    h("p", { class: "fm-detail-addr", text: [s.address?.trim(), s.locality, `${s.municipality} (${s.district})`].filter(Boolean).join(", ") }),
    compare ? h("p", { class: "fm-detail-compare", text: compare }) : null,
    h("table", { class: "fm-table fm-detail-table" }, [
      h("caption", { text: `Prices published on ${formatDate(data.dates[data.dayIndex(state)])}` }),
      h("thead", {}, [h("tr", {}, [h("th", { scope: "col", text: "Fuel" }), h("th", { scope: "col", class: "num", text: "Price" }), h("th", { scope: "col", text: "Updated (DGEG)" })])]),
      h("tbody", {}, d.rows.map((r) => h("tr", { class: r.fuel.id === state.fuel ? "selected" : "" }, [
        h("td", {}, [h("span", { text: r.fuel.label }), h("span", { class: "sub", text: r.fuel.name })]),
        h("td", { class: "num price", text: formatPrice(r.price, r.fuel.unit) }),
        h("td", { text: r.updatedAt ? formatLisbon(r.updatedAt) : "–" }),
      ]))),
    ]),
    h("p", { class: "fm-detail-note", text: d.history ? `${fuel.label}: published prices, ${formatDate(data.dates[0])} – ${formatDate(data.dates[data.dates.length - 1])}` : `This station did not publish ${fuel.label} in this period.` }),
    spark,
  );
  if (d.history) renderSpark(spark, { values: d.history, dates: data.dates, unit: fuel.unit, selected: data.dayIndex(state), interactive: true, height: 64, family: fuel.family, premium: fuel.premium });
  return true;
}

// ---------- scope line ----------
export function scopeText(data, state) {
  const f = data.fuelById.get(state.fuel);
  const parts = [f.label, areaLabel(state)];
  if (state.brand) parts.push(brandLabel(state.brand));
  if (state.type) parts.push(typeLabel(state.type));
  return `${parts.join(" · ")} · prices published on ${formatDate(data.dates[data.dayIndex(state)])}`;
}

export function showLoadError(container) {
  container.replaceChildren(emptyNode("We couldn't load the price data. Check your connection and try again.", [{ label: "Try again", onClick: () => location.reload() }]));
}
