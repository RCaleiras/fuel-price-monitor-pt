// Dashboard controller: loads data/dashboard.json once, keeps the selection in the URL and redraws every view from it.
// Layout: filter rail + selection bar + price board + linked panels (trend, comparison, map, table, movers) + detail drawer.
// All text from the data is set with textContent (never innerHTML).
import { attachTip, renderSpark, showTip } from "./charts.js";
import { direction, formatCount, formatDate, formatDay, formatDelta, formatEuro, formatPercent, formatPrice, loadModel, unitLabel } from "./lib.js";
import { RESET_PATCH, createData, createStore, paramsFromState, stateFromParams } from "./model.js";
import { compareSentence, summarySegments } from "./story.js";
import {
  activeFilters, bindFilters, bindSearch, freshness, h, renderChips, renderHistoryBanner, renderStationDetail, renderStationTable,
  scopeText, selectFuel, showLoadError, syncFilters, toggleCompare,
} from "./ui.js";
import { bindTabs, keepFocus, onWidthChange, renderCompareView, renderMapView, renderMoversView, renderStats, renderTrendView } from "./views.js";

const DATA_URL = "data/dashboard.json";
const SUPPORTED_SCHEMA = 1;
const PAGE_SIZE = 14;
const SHEET_BREAKPOINT_PX = 900;
const KPI_HELP = "Median of the prices stations published that day: half are cheaper, half dearer. The change compares with the median "
  + "7 days earlier, same filters; it is hidden when either day has no prices or the station counts differ by more than 20%. "
  + "Stations that did not publish that day are left out, never filled in with an old price.";
const ARROW = { up: "▲", down: "▼", flat: "▬", none: "" };

const $ = (id) => document.getElementById(id);
let data;
let store;
let mapApi = { highlight: () => {} };
let drawerTriggerKey = null; // data-fk of the element that opened the drawer (nodes are replaced on every render)

// ---------- header ----------
function renderFreshness() {
  const f = freshness(data);
  $("fresh").replaceChildren(h("span", { class: `pill${f.stale ? " stale" : ""}`, title: `${f.days} days collected since ${f.since} · built ${f.generated}` }, [
    h("span", { class: "dot", "aria-hidden": "true" }),
    h("span", { text: f.stale ? `Out of date · ${f.latest}` : `Updated · ${f.latest}` }),
  ]));
  $("stale").hidden = !f.stale;
  $("stale").textContent = f.staleText;
}

// ---------- summary and price board ----------
function renderSummary(state) {
  $("summary").replaceChildren(...summarySegments(data, state).map((s) => (s.strong ? h("strong", { text: s.text }) : s.text)));
}

function kpiCard(state, fuel) {
  const k = data.kpi(state, fuel.id);
  const selected = fuel.id === state.fuel;
  const inCompare = state.compare.includes(fuel.id) && !state.hidden.includes(fuel.id);
  const dir = k.comparable ? direction(k.delta) : "none";
  const spark = h("span", { class: "k-spark" });
  const card = h("button", { type: "button", "data-fk": `fuel-${fuel.id}`, "aria-pressed": String(selected),
    class: `kpi fam-${fuel.family}${fuel.premium ? " premium" : ""}${selected ? " selected" : ""}${inCompare ? " in-compare" : ""}`,
    onclick: () => selectFuel(data, store, fuel.id) }, [
    h("span", { class: "stripe", "aria-hidden": "true" }),
    h("span", { class: "k-name" }, [h("span", { class: "label", text: fuel.label }), h("span", { class: "orig", text: fuel.name })]),
    h("span", { class: "k-price" }, k.current
      ? [h("span", { class: "digits", text: formatEuro(k.current.median).slice(1) }), h("span", { class: "unit", text: `€/${unitLabel(fuel.unit)}` })]
      : [h("span", { class: "nodata", text: "No prices" })]),
    h("span", { class: `k-delta ${dir}` }, k.comparable
      ? [h("span", { "aria-hidden": "true", text: ARROW[dir] }), ` ${formatDelta(k.delta)} `, h("span", { class: "pct", text: formatPercent(k.deltaPct) })]
      : [h("span", { class: "nocomp", text: "No 7-day comparison" })]),
    h("span", { class: "k-n", text: k.current ? `${formatCount(k.current.n)} stations` : "" }),
    spark,
  ]);
  attachTip(card, () => ({
    title: `${fuel.label} · ${formatDate(k.dayIso)}`,
    rows: k.current ? [
      { value: formatPrice(k.current.median, fuel.unit), label: "median" },
      { value: `${formatEuro(k.current.p10)} – ${formatEuro(k.current.p90)}`, label: "P10–P90" },
      { value: k.comparable ? `${formatDelta(k.delta)} (${formatPercent(k.deltaPct)})` : "–",
        label: k.comparable ? `vs ${formatDay(k.refIso)} (${formatPrice(k.reference.median, fuel.unit)})` : k.reason },
      { value: formatCount(k.current.n), label: "stations published" },
    ] : [{ value: "No data", label: "no station published this fuel" }],
    hint: selected ? "Selected fuel" : "Click to show this fuel in every panel",
  }));
  const draw = () => renderSpark(spark, { values: k.series.map((d) => d?.median ?? null), dates: data.dates, unit: fuel.unit,
    selected: data.dayIndex(state), family: fuel.family, premium: fuel.premium, height: 24 });
  return { card, draw };
}

function renderBoard(state) {
  const fuels = [...data.fleet];
  const current = data.fuelById.get(state.fuel);
  if (!current.fleet) fuels.push(current);
  const cards = fuels.map((f) => kpiCard(state, f));
  $("kpis").replaceChildren(...cards.map((c) => c.card));
  for (const c of cards) c.draw(); // sparklines measure their box, so they draw once attached
  const latest = data.isLatest(state);
  $("board-day").replaceChildren(h("span", { class: latest ? "tag" : "tag hist", text: latest ? "Latest" : "Historical" }),
    ` ${formatDate(data.dates[data.dayIndex(state)])}`);
}

// ---------- station drawer ----------
function openDrawer(trigger) {
  drawerTriggerKey = (trigger ?? document.activeElement)?.dataset?.fk ?? null;
  requestAnimationFrame(() => $("drawer").querySelector(".fm-icon-btn")?.focus({ preventScroll: true }));
}

function closeDrawer() {
  store.set({ station: null });
  const back = drawerTriggerKey && document.querySelector(`[data-fk="${CSS.escape(drawerTriggerKey)}"]`);
  drawerTriggerKey = null;
  (back || $("map").querySelector("svg"))?.focus({ preventScroll: true });
}

function renderDrawer(state) {
  const open = renderStationDetail($("detail"), data, state, store, { onClose: closeDrawer });
  $("drawer").hidden = !open;
  $("scrim").hidden = !open || window.innerWidth > SHEET_BREAKPOINT_PX;
  document.body.classList.toggle("drawer-open", open);
}

// ---------- render ----------
function render() {
  const state = store.get();
  history.replaceState(null, "", `${location.pathname}?${paramsFromState(state, data)}`);
  document.body.dataset.fuel = data.fuelById.get(state.fuel).family;
  syncFilters(document, data, state);
  if ($("search").value !== state.search) $("search").value = state.search;
  const count = activeFilters(data, state).length;
  $("filter-count").hidden = count === 0;
  $("filter-count").textContent = String(count);
  $("scope").textContent = scopeText(data, state);
  renderChips($("chips"), data, state, store, { emptyText: "All of mainland Portugal · no filters" });
  renderHistoryBanner($("history"), data, state, store);
  renderSummary(state);
  renderBoard(state);
  $("mode-single").setAttribute("aria-pressed", String(!state.compare.length));
  $("mode-compare").setAttribute("aria-pressed", String(state.compare.length > 0));
  renderTrendView({ chart: $("trend"), legend: $("legend"), table: $("trend-table"), note: $("trend-note") }, data, state, store, { height: 300 });
  renderStats($("stats"), data, state);
  $("compare-sentence").textContent = compareSentence(data, state);
  renderCompareView({ dots: $("dots"), note: $("compare-note"), foot: $("dots-foot"), table: $("dots-table"),
    tabs: [...document.querySelectorAll("[data-group]")] }, data, state, store);
  mapApi = renderMapView({ map: $("map"), legend: $("map-legend"), note: $("map-note") }, data, state, store,
    { maxHeight: 480, onSelect: () => openDrawer($("map").querySelector("svg")) });
  const n = renderStationTable($("stations"), data, state, store, { pageSize: PAGE_SIZE, onHover: (code) => mapApi.highlight(code), onOpen: () => openDrawer() });
  const sortName = { vsMedian: "difference from median", place: "location", updated: "update time" }[state.sort.key] ?? state.sort.key;
  $("stations-note").textContent = `${formatCount(n)} stations${state.search.trim() ? ` matching “${state.search.trim()}”` : ""} · sorted by ${sortName}`;
  renderMoversView({ box: $("movers"), note: $("movers-note") }, data, state, store, { onOpen: () => openDrawer() });
  renderDrawer(state);
}

// ---------- shell: mobile filter sheet, keyboard shortcuts ----------
function setSheet(open) {
  document.body.classList.toggle("sheet-open", open);
  $("filters-btn").setAttribute("aria-expanded", String(open));
  (open ? $("f-fuel") : $("filters-btn")).focus();
}

function bindShell() {
  $("mode-single").addEventListener("click", () => toggleCompare(data, store, false));
  $("mode-compare").addEventListener("click", () => toggleCompare(data, store, true));
  $("reset-all").addEventListener("click", () => store.set(RESET_PATCH));
  $("filters-btn").addEventListener("click", () => setSheet(!document.body.classList.contains("sheet-open")));
  $("rail-close").addEventListener("click", () => setSheet(false));
  $("rail-done").addEventListener("click", () => setSheet(false));
  $("scrim").addEventListener("click", closeDrawer);
  $("filters").addEventListener("submit", (e) => e.preventDefault());
  const help = [{ value: "", label: KPI_HELP }];
  attachTip($("kpi-info"), () => ({ title: "How these prices are calculated", rows: help }));
  $("kpi-info").addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); showTip(r.left, r.bottom, "How these prices are calculated", help); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, select, textarea");
    if (e.key === "/" && !typing) { e.preventDefault(); $("search").focus(); return; }
    if (e.key !== "Escape") return;
    if (store.get().station !== null) { closeDrawer(); return; }
    if (document.body.classList.contains("sheet-open")) { setSheet(false); return; }
    if (store.get().day !== null && !typing && !e.target.closest(".fm-trend")) store.set({ day: null });
  });
}

// ---------- start ----------
async function load() {
  const response = await fetch(DATA_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.schema_version !== SUPPORTED_SCHEMA || !payload.dates?.length) throw new Error("unexpected data format");
  return createData(loadModel(payload));
}

async function start() {
  try {
    data = await load();
    store = createStore(stateFromParams(new URLSearchParams(location.search), data));
    renderFreshness();
    bindFilters(document, data, store);
    bindSearch($("search"), store);
    bindTabs([...document.querySelectorAll("[data-group]")], store);
    bindShell();
    store.subscribe(() => keepFocus(render));
    render();
  } catch {
    document.body.classList.remove("is-loading");
    document.body.classList.add("load-failed");
    showLoadError($("status"));
    $("fresh").replaceChildren();
    return;
  }
  document.body.classList.remove("is-loading");
  onWidthChange(() => keepFocus(render));
}

start();
