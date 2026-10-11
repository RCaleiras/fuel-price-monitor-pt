// View logic: what each chart shows and what a click on it does.
import { hideTip, mapLegend, renderDotRange, renderMap, renderTrend } from "./charts.js";
import { formatCount, formatDate, formatDelta, formatEuro, formatPrice, unitLabel } from "./lib.js";
import { MIN_BRAND_STATIONS, areaLabel, brandLabel } from "./model.js";
import { h, renderLegend, trendSeries } from "./ui.js";

export function onSelectDayFor(data, store, start) {
  return (i) => {
    const day = i === null ? null : start + i;
    store.set({ day: day === null || day === data.latest ? null : day });
  };
}

export function renderTrendView({ chart, legend, table, note }, data, state, store, { height } = {}) {
  const t = trendSeries(data, state);
  const fuel = data.fuelById.get(state.fuel);
  if (legend) renderLegend(legend, data, state, store);
  renderTrend(chart, { dates: t.dates, series: t.series, unit: fuel.unit, band: state.compare.length === 0, selected: t.selected,
    onSelectDay: onSelectDayFor(data, store, t.start), height });
  if (note) {
    note.textContent = state.compare.length
      ? `Median per day · ${areaLabel(state)} · €/${unitLabel(fuel.unit)} · dashed line = premium grade · thicker = selected fuel`
      : `${fuel.label} · ${areaLabel(state)} · €/${unitLabel(fuel.unit)} · line: median · band: middle 80% of stations (P10–P90)`;
  }
  if (table) {
    const head = ["Day", ...t.series.map((s) => `${s.label} (median)`), ...(t.series.length === 1 ? ["P10", "P90", "Stations"] : [])];
    const rows = t.dates.map((d, i) => [formatDate(d), ...t.series.map((s) => formatEuro(s.points[i]?.median)),
      ...(t.series.length === 1 ? [formatEuro(t.series[0].points[i]?.p10), formatEuro(t.series[0].points[i]?.p90), t.series[0].points[i] ? formatCount(t.series[0].points[i].n) : "0"] : [])]);
    table.replaceChildren(simpleTable(head, rows));
  }
  return t;
}

const GROUP_TEXT = {
  district: { by: "district", hint: "Click to filter by this district" },
  municipality: { by: "municipality", hint: "Click to filter by this municipality" },
  locality: { by: "locality", hint: "" },
  brand: { by: "brand", hint: "Click to filter the whole dashboard by this brand" },
  type: { by: "station type", hint: "Click to filter the whole dashboard by this station type" },
};

export function renderCompareView({ dots, note, foot, table, tabs }, data, state, store) {
  const g = data.groups(state);
  const fuel = data.fuelById.get(state.fuel);
  const text = GROUP_TEXT[g.key];
  for (const tab of tabs ?? []) {
    const on = tab.dataset.group === state.groupBy;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  const onSelect = {
    district: (k) => store.set({ district: k ?? "", station: null }),
    municipality: (k) => store.set({ municipality: k ?? "", station: null }),
    locality: null,
    brand: (k) => store.set({ brand: k ?? "", station: null }),
    type: (k) => store.set({ type: k ?? "", station: null }),
  }[g.key];
  const selectedKey = g.key === "brand" ? state.brand : g.key === "type" ? state.type : null;
  const context = data.groupContext(state);
  renderDotRange(dots, { rows: g.rows, unit: fuel.unit, selectedKey, onSelect, reference: data.scopeSummary(context)?.median,
    referenceLabel: "Median", actionHint: text.hint });
  if (table) {
    table.replaceChildren(simpleTable([text.by[0].toUpperCase() + text.by.slice(1), "Median", "P10", "P90", "Min", "Max", "Stations"],
      g.rows.map((r) => [r.label, formatEuro(r.median), formatEuro(r.p10), formatEuro(r.p90), formatEuro(r.min), formatEuro(r.max), formatCount(r.n)])));
  }
  if (note) note.textContent = `${fuel.label} by ${text.by} · ${areaLabel(state)} · ${formatDate(data.dates[data.dayIndex(state)])}`;
  if (foot) {
    const parts = ["Dot: median · bar: P10–P90 · thin line: min–max"];
    if (g.key === "locality") parts.push("Localities are the finest level; clear the municipality to go back up");
    if (g.hiddenCount) parts.push(`${g.hiddenCount} brands with fewer than ${MIN_BRAND_STATIONS} stations are not plotted`);
    foot.textContent = parts.join(" · ");
  }
}

export function bindTabs(tabs, store) {
  tabs.forEach((tab, k) => {
    tab.addEventListener("click", () => store.set({ groupBy: tab.dataset.group }));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = tabs[(k + step + tabs.length) % tabs.length];
      next.focus();
      store.set({ groupBy: next.dataset.group });
    });
  });
}

export function renderMapView({ map, legend, note }, data, state, store, { maxHeight, onSelect } = {}) {
  const fuel = data.fuelById.get(state.fuel);
  const points = data.mapPoints(state);
  const api = renderMap(map, { points, unit: fuel.unit, selectedCode: state.station, maxHeight,
    onSelect: (code) => { store.set({ station: code }); onSelect?.(code); } });
  if (legend) legend.replaceChildren(api.bins.length ? mapLegend(api.bins, fuel.unit) : "");
  if (note) note.textContent = `${formatCount(points.length)} stations · ${fuel.label} · ${formatDate(data.dates[data.dayIndex(state)])}`;
  return api;
}

const MOVERS_SHOWN = 8;

/** Biggest station price changes over the 7 days to the inspected day; rows open the station. */
export function renderMoversView({ box, note }, data, state, store, { onOpen } = {}) {
  const fuel = data.fuelById.get(state.fuel);
  const m = data.weekMovers(state);
  const dayIso = data.dates[data.dayIndex(state)];
  if (!m.available) {
    note.textContent = "";
    box.replaceChildren(h("p", { class: "fm-empty", text: `Station changes need data from ${formatDate(m.refIso)}, 7 days before ${formatDate(dayIso)}.` }));
    return;
  }
  note.textContent = `${formatDate(m.refIso)} → ${formatDate(dayIso)} · stations that published on both days · ${formatCount(m.list.length)} changed price`;
  const table = (title, list) => h("div", { class: "fm-movers-col" }, [
    h("h3", { text: title }),
    list.length === 0 ? h("p", { class: "fm-empty", text: "None." }) : h("div", { class: "fm-table-wrap" }, [h("table", { class: "fm-table" }, [
      h("thead", {}, [h("tr", {}, [h("th", { scope: "col", text: "Station" }), h("th", { scope: "col", class: "num", text: "Before" }),
        h("th", { scope: "col", class: "num", text: "Now" }), h("th", { scope: "col", class: "num", text: "Change" })])]),
      h("tbody", {}, list.map((r) => h("tr", { onclick: (e) => { if (!e.target.closest("button")) { store.set({ station: r.station.code }); onOpen?.(); } } }, [
        h("td", {}, [h("button", { type: "button", class: "fm-station-link", "data-fk": `mv-${r.station.code}`, text: r.station.name,
          onclick: () => { store.set({ station: r.station.code }); onOpen?.(); } }),
          h("span", { class: "sub", text: `${brandLabel(r.station.brand)} · ${r.station.municipality}` })]),
        h("td", { class: "num", text: formatEuro(r.before) }),
        h("td", { class: "num", text: formatEuro(r.now) }),
        h("td", { class: `num delta ${r.change > 0 ? "up" : "down"}`, text: `${r.change > 0 ? "▲" : "▼"} ${formatDelta(r.change)}` }),
      ]))),
    ])]),
  ]);
  box.replaceChildren(
    table(`Biggest rises (€/${unitLabel(fuel.unit)})`, m.list.filter((r) => r.change > 0).slice(0, MOVERS_SHOWN)),
    table(`Biggest falls (€/${unitLabel(fuel.unit)})`, m.list.filter((r) => r.change < 0).slice(0, MOVERS_SHOWN)),
  );
}

export function statItems(data, state) {
  const fuel = data.fuelById.get(state.fuel);
  const s = data.scopeSummary(state);
  if (!s) return [["Prices", "No data"]];
  const items = [["Median", formatPrice(s.median, fuel.unit)], ["Mean", formatPrice(Math.round(s.mean), fuel.unit)],
    ["Range", `${formatEuro(s.min)} – ${formatEuro(s.max)}`], ["Stations", formatCount(s.n)]];
  const unfiltered = !state.district && !state.brand && !state.type;
  const act = unfiltered ? data.activity(state) : null;
  if (act) items.push(["Price changes (country)", formatCount(act.changes)], ["Not published (excluded)", formatCount(act.carried)]);
  return items;
}

export function renderStats(dl, data, state) {
  dl.replaceChildren(...statItems(data, state).map(([k, v]) => h("div", {}, [h("dt", { text: k }), h("dd", { text: v })])));
}

export function simpleTable(headers, rows) {
  return h("div", { class: "fm-table-wrap" }, [h("table", { class: "fm-table static" }, [
    h("thead", {}, [h("tr", {}, headers.map((x, i) => h("th", { scope: "col", class: i ? "num" : "", text: x })))]),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v, i) => h("td", { class: i ? "num" : "", text: v }))))),
  ])]);
}

/** Debounced redraw on width changes only (mobile browsers fire resize when the toolbar hides). */
export function onWidthChange(fn, ms = 150) {
  let last = window.innerWidth, timer;
  window.addEventListener("resize", () => {
    if (window.innerWidth === last) return;
    last = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  });
}

/** Re-renders replace nodes; put keyboard focus back on the element with the same data-fk key. */
export function keepFocus(fn) {
  const key = document.activeElement?.dataset?.fk;
  hideTip(); // the node that showed it is about to be replaced and will never fire blur/pointerleave
  fn();
  if (!key) return;
  const find = (k) => document.querySelector(`[data-fk="${CSS.escape(k)}"]`);
  let target = find(key);
  if (target?.disabled) target = find(FOCUS_SWAP[key] ?? "") ?? null; // e.g. "Next" disabled on the last page
  if (!target && key.startsWith("chip-")) target = find("chip-0") ?? document.getElementById("search"); // last chip removed
  target?.focus({ preventScroll: true });
}

const FOCUS_SWAP = { "pager-next": "pager-prev", "pager-prev": "pager-next" };
