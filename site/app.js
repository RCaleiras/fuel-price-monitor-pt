// Dashboard controller: loads data/dashboard.json once, keeps the filters in the URL and redraws every view from them.
// All text from the data is set with textContent (never innerHTML).
import { hideTooltip, priceBins, renderAreas, renderMap, renderSparkline, renderTrend } from "./charts.js";
import {
  compareDays,
  filterPairs,
  formatDate,
  formatDelta,
  formatPercent,
  formatPrice,
  groupSummary,
  loadModel,
  movers,
  referenceIndex,
  seriesByDay,
  staleDays,
  summarize,
} from "./lib.js";

const DATA_URL = "data/dashboard.json";
const SUPPORTED_SCHEMA = 1;
const COMPARE_DAYS = 7;
const STALE_AFTER_DAYS = 2;
const PAGE_SIZE = 20;
const MOVERS_SHOWN = 10;
const RESIZE_DEBOUNCE_MS = 150;
const SEARCH_DEBOUNCE_MS = 150;
// The 7-day change compares two medians; if the number of stations differs a lot between the two days, the change
// would reflect which stations published, not prices. Then it is hidden.
const MIN_COVERAGE_RATIO = 0.8;
const DEFAULT_FUEL = "Gasóleo simples";
const FLEET_ORDER = ["Gasóleo simples", "Gasolina simples 95", "Gasóleo especial", "Gasolina especial 95",
  "Gasolina 98", "Gasolina especial 98", "GPL Auto"];

const $ = (id) => document.getElementById(id);
const COLLATOR = new Intl.Collator("pt", { sensitivity: "base", numeric: true });
const LISBON_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short", timeStyle: "short" });
const UTC_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" });

let model;
const state = { fuel: null, district: "", municipality: "", window: "all", search: "", sort: { key: "price", dir: 1 }, page: 0, station: null };

// ---------- small DOM helpers ----------
function node(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

const fold = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fuel = () => model.fuels.get(state.fuel);
const unitShort = (unit) => (unit === "litro" ? "l" : unit);

// ---------- state <-> URL ----------
function readUrl() {
  const q = new URLSearchParams(location.search);
  const fuelId = Number(q.get("combustivel"));
  const byName = [...model.fuels.values()].find((f) => f.name === DEFAULT_FUEL);
  state.fuel = model.fuels.has(fuelId) ? fuelId : (byName ?? [...model.fuels.values()][0]).id;
  const districts = new Set(model.stations.map((s) => s.district));
  state.district = districts.has(q.get("distrito")) ? q.get("distrito") : "";
  const municipalities = new Set(model.stations.filter((s) => s.district === state.district).map((s) => s.municipality));
  state.municipality = state.district && municipalities.has(q.get("concelho")) ? q.get("concelho") : "";
  state.window = q.get("periodo") === "7" ? "7" : "all";
}

function writeUrl() {
  const q = new URLSearchParams();
  q.set("combustivel", state.fuel);
  if (state.district) q.set("distrito", state.district);
  if (state.municipality) q.set("concelho", state.municipality);
  if (state.window === "7") q.set("periodo", "7");
  history.replaceState(null, "", `${location.pathname}?${q}`);
}

function update(changes) {
  Object.assign(state, changes);
  if ("district" in changes && !("municipality" in changes)) state.municipality = "";
  if (!("page" in changes)) state.page = 0;
  writeUrl();
  render();
}

// ---------- filters ----------
function fillFilters() {
  const fuelSelect = $("f-fuel");
  const fleet = node("optgroup", { label: "Combustíveis rodoviários comuns" });
  const other = node("optgroup", { label: "Outros" });
  const fuels = [...model.fuels.values()].sort((a, b) => {
    const ia = FLEET_ORDER.indexOf(a.name), ib = FLEET_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || COLLATOR.compare(a.name, b.name);
  });
  for (const f of fuels) (f.fleet ? fleet : other).append(node("option", { value: f.id, text: f.name }));
  fuelSelect.replaceChildren(fleet, other);
  fuelSelect.addEventListener("change", () => update({ fuel: Number(fuelSelect.value), station: null }));

  const districts = [...new Set(model.stations.map((s) => s.district))].sort(COLLATOR.compare);
  $("f-district").append(...districts.map((d) => node("option", { value: d, text: d })));
  $("f-district").addEventListener("change", (e) => update({ district: e.target.value }));
  $("f-municipality").addEventListener("change", (e) => update({ municipality: e.target.value }));
  for (const radio of document.querySelectorAll('input[name="window"]')) {
    radio.addEventListener("change", (e) => update({ window: e.target.value }));
  }
  $("reset").addEventListener("click", () => update({ district: "", municipality: "", window: "all", search: "", station: null }));
  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      state.page = 0;
      renderStationsCard(filterPairs(model, state)); // search narrows the table only
    }, SEARCH_DEBOUNCE_MS);
  });
  $("filters").addEventListener("submit", (e) => e.preventDefault());
}

function syncFilters() {
  $("f-fuel").value = String(state.fuel);
  $("f-district").value = state.district;
  const muni = $("f-municipality");
  const names = [...new Set(model.stations.filter((s) => s.district === state.district).map((s) => s.municipality))].sort(COLLATOR.compare);
  muni.replaceChildren(node("option", { value: "", text: "Todos os concelhos" }), ...names.map((m) => node("option", { value: m, text: m })));
  muni.disabled = !state.district;
  muni.value = state.municipality;
  for (const radio of document.querySelectorAll('input[name="window"]')) radio.checked = radio.value === state.window;
  if ($("search").value !== state.search) $("search").value = state.search;
}

function areaLabel() {
  if (state.municipality) return `concelho de ${state.municipality} (${state.district})`;
  if (state.district) return `distrito de ${state.district}`;
  return "Portugal continental";
}

// ---------- header ----------
function renderMeta() {
  const { coverage, generated_at: generatedAt } = model;
  $("meta").textContent = `Último dia de dados: ${formatDate(coverage.latest_date)} · ${coverage.n_days} dias recolhidos desde ${formatDate(coverage.first_date)} · gerado em ${UTC_TIME.format(new Date(generatedAt))} UTC`;
  const late = staleDays(coverage.latest_date);
  const stale = $("stale");
  stale.hidden = late <= STALE_AFTER_DAYS;
  stale.textContent = `Atenção: os dados mais recentes têm ${late} dias. A recolha diária pode ter falhado; os valores podem não refletir os preços atuais.`;
  $("window-all").textContent = `Tudo (${model.dates.length} dias)`;
}

// ---------- KPIs ----------
function compareFor(fuelId, latest, ref) {
  return compareDays(filterPairs(model, { fuel: fuelId, district: state.district, municipality: state.municipality }), latest, ref);
}

function comparable(cmp) {
  if (cmp.delta === null) return false;
  const ratio = cmp.current.n / cmp.reference.n;
  return ratio >= MIN_COVERAGE_RATIO && ratio <= 1 / MIN_COVERAGE_RATIO;
}

function deltaText(cmp, unit, refDate) {
  if (cmp.delta === null) return refDate ? `sem comparação com ${formatDate(refDate)}` : `sem dados de há ${COMPARE_DAYS} dias`;
  if (!comparable(cmp)) return `sem comparação fiável (${cmp.current.n} vs ${cmp.reference.n} postos em ${formatDate(refDate)})`;
  return `${formatDelta(cmp.delta, unit)} (${formatPercent(cmp.deltaPct)}) vs ${formatDate(refDate)}`;
}

function renderTiles() {
  const latest = model.latestIndex;
  const ref = referenceIndex(model.dates, COMPARE_DAYS);
  const refDate = ref === null ? null : model.dates[ref];
  const shown = FLEET_ORDER.map((n) => [...model.fuels.values()].find((f) => f.name === n)).filter(Boolean);
  if (!shown.some((f) => f.id === state.fuel)) shown.push(fuel());
  $("tiles").replaceChildren(...shown.map((f) => {
    const cmp = compareFor(f.id, latest, ref);
    return node("button", { type: "button", class: "tile", "aria-pressed": String(f.id === state.fuel), onclick: () => update({ fuel: f.id, station: null }) }, [
      node("span", { class: "name", text: f.name }),
      node("span", { class: "value", text: formatPrice(cmp.current?.median ?? null, f.unit) }),
      node("span", { class: "delta", text: deltaText(cmp, f.unit, refDate) }),
      node("span", { class: "n", text: cmp.current ? `mediana de ${cmp.current.n} postos` : "sem preços publicados" }),
    ]);
  }));
}

function renderStats(pairs) {
  const f = fuel();
  const s = summarize(pairs.map((p) => p.prices[model.latestIndex]).filter((v) => v !== null));
  const items = s
    ? [["Mediana", formatPrice(s.median, f.unit)], ["Média simples", formatPrice(Math.round(s.mean), f.unit)],
       ["Mínimo", formatPrice(s.min, f.unit)], ["Máximo", formatPrice(s.max, f.unit)], ["Postos", String(s.n)]]
    : [["Preço", "sem dados"]];
  if (!state.district) {
    const act = model.activity.find((a) => a.fuel === state.fuel && a.date === model.coverage.latest_date);
    if (act) items.push(["Preços alterados (país)", String(act.changes)], ["Preços não publicados hoje (excluídos)", String(act.carried)]);
  }
  $("stats").replaceChildren(...items.map(([k, v]) => node("div", {}, [node("dt", { text: k }), node("dd", { text: v })])));
  $("scope").textContent = `${f.name} · ${areaLabel()} · preços publicados em ${formatDate(model.coverage.latest_date)}`;
}

// ---------- charts ----------
function renderTrendCard(pairs) {
  const f = fuel();
  const start = state.window === "7" ? Math.max(0, model.dates.length - COMPARE_DAYS) : 0;
  const dates = model.dates.slice(start);
  const series = seriesByDay(pairs, model.dates.length).slice(start);
  $("trend-note").textContent = `${f.name}, ${areaLabel()} · €/${unitShort(f.unit)} · linha: mediana · faixa: P10–P90`;
  renderTrend($("trend"), { dates, series, unit: f.unit });
  const rows = series.map((s, i) => [formatDate(dates[i]), s ? formatPrice(s.median, f.unit) : "sem dados",
    s ? formatPrice(s.p10, f.unit) : "–", s ? formatPrice(s.p90, f.unit) : "–", s ? String(s.n) : "0"]);
  $("trend-table").replaceChildren(simpleTable(["Dia", "Mediana", "P10", "P90", "Postos"], rows, [1, 2, 3, 4]));
}

function renderAreasCard(pairs) {
  const f = fuel();
  const key = state.municipality ? "locality" : state.district ? "municipality" : "district";
  const groups = groupSummary(pairs, model.stations, model.latestIndex, key);
  const label = { district: "distrito", municipality: "concelho", locality: "localidade" }[key];
  $("areas-note").textContent = `Por ${label} · ${formatDate(model.coverage.latest_date)} · ponto: mediana · linha: mín.–máx.${key !== "locality" ? " · clique para filtrar" : ""}`;
  const onSelect = key === "district" ? (k) => update({ district: k }) : (k) => update({ municipality: k });
  renderAreas($("areas"), { groups, unit: f.unit, selected: null, onSelect: key === "locality" ? null : onSelect });
  const rows = groups.map((g) => [g.key, formatPrice(g.median, f.unit), formatPrice(g.min, f.unit), formatPrice(g.max, f.unit), String(g.n)]);
  $("areas-table").replaceChildren(simpleTable([label[0].toUpperCase() + label.slice(1), "Mediana", "Mínimo", "Máximo", "Postos"], rows, [1, 2, 3, 4]));
}

function renderMapCard(pairs) {
  const f = fuel();
  const points = pairs
    .filter((p) => p.prices[model.latestIndex] !== null && p.station.lat !== null && p.station.lon !== null)
    .map((p) => ({ station: p.station, price: p.prices[model.latestIndex] }));
  const bins = priceBins(points.map((p) => p.price));
  $("map-note").textContent = `${points.length} postos · preços de ${formatDate(model.coverage.latest_date)} · cada cor tem cerca de 1/5 dos postos`;
  renderMap($("map"), { points, bins, unit: f.unit, selectedCode: state.station, onSelect: (code) => update({ station: code, page: state.page }) });
  $("map-legend").replaceChildren(...bins.map((b, i) => node("span", {}, [
    node("i", { class: `swatch-${i + 1}` }),
    `${formatPrice(b.min, f.unit).replace(/ €.*/, "")}–${formatPrice(b.max, f.unit)}`,
  ])));
}

// ---------- station detail ----------
function renderStationDetail() {
  const box = $("station-detail");
  const pairs = state.station === null ? [] : model.pairs.filter((p) => p.station.code === state.station);
  if (pairs.length === 0) { box.hidden = true; return; }
  const s = pairs[0].station;
  const latest = model.latestIndex;
  const list = node("table", {}, [
    node("thead", {}, [node("tr", {}, [node("th", { text: "Combustível" }), node("th", { class: "num", text: "Preço" }), node("th", { text: "Atualizado pela DGEG" })])]),
    node("tbody", {}, pairs.map((p) => {
      const f = model.fuels.get(p.fuel);
      return node("tr", {}, [node("td", { text: f.name }), node("td", { class: "num", text: formatPrice(p.prices[latest], f.unit) }),
        node("td", { text: p.updatedAt ? LISBON_TIME.format(new Date(p.updatedAt)) : "–" })]);
    })),
  ]);
  const spark = node("div");
  const current = pairs.find((p) => p.fuel === state.fuel);
  box.replaceChildren(
    node("h3", { text: s.name }),
    node("p", { text: [s.brand, s.type, s.address, s.locality, `${s.municipality} (${s.district})`].filter(Boolean).join(" · ") }),
    node("div", { class: "table-wrap" }, [list]),
    node("p", { class: "note", text: current ? `Histórico de ${fuel().name} (dias publicados)` : `Este posto não publicou ${fuel().name}.` }),
    spark,
    node("button", { type: "button", class: "link", text: "Fechar", onclick: () => update({ station: null, page: state.page }) }),
  );
  if (current) renderSparkline(spark, { dates: model.dates, prices: current.prices, unit: fuel().unit });
  box.hidden = false;
}

// ---------- stations table ----------
const COLUMNS = [
  { key: "name", label: "Posto", get: (r) => r.station.name },
  { key: "brand", label: "Marca", get: (r) => r.station.brand },
  { key: "municipality", label: "Concelho", get: (r) => r.station.municipality },
  { key: "locality", label: "Localidade", get: (r) => r.station.locality ?? "" },
  { key: "type", label: "Tipo", get: (r) => r.station.type },
  { key: "price", label: "Preço", get: (r) => r.price, num: true },
  { key: "updated", label: "Atualizado pela DGEG", get: (r) => r.updatedAt ?? "" },
];

function stationRows(pairs) {
  const needle = fold(state.search.trim());
  let rows = pairs.filter((p) => p.prices[model.latestIndex] !== null)
    .map((p) => ({ station: p.station, price: p.prices[model.latestIndex], updatedAt: p.updatedAt }));
  if (needle) {
    rows = rows.filter((r) => [r.station.name, r.station.brand, r.station.locality, r.station.municipality, r.station.address]
      .some((v) => fold(v).includes(needle)));
  }
  const col = COLUMNS.find((c) => c.key === state.sort.key);
  return rows.sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    const cmp = col.num ? va - vb : COLLATOR.compare(String(va), String(vb));
    return cmp * state.sort.dir || a.price - b.price;
  });
}

function renderStationsCard(pairs) {
  const f = fuel();
  const rows = stationRows(pairs);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const searched = state.search.trim() ? " correspondem à pesquisa" : "";
  $("stations-note").textContent = `${rows.length} postos${searched} · ${f.name} · ${formatDate(model.coverage.latest_date)}`;

  const head = node("tr", {}, COLUMNS.map((c) => {
    const sorted = c.key === state.sort.key;
    const th = node("th", { class: c.num ? "num" : "", scope: "col" }, [node("button", { type: "button", text: c.label,
      onclick: () => update({ sort: { key: c.key, dir: sorted ? -state.sort.dir : 1 } }) })]);
    if (sorted) th.setAttribute("aria-sort", state.sort.dir === 1 ? "ascending" : "descending");
    return th;
  }));
  const body = slice.length === 0
    ? [node("tr", {}, [node("td", { colspan: COLUMNS.length, class: "empty", text: "Nenhum posto corresponde à pesquisa e aos filtros." })])]
    : slice.map((r) => node("tr", {}, [
      node("td", {}, [node("button", { type: "button", class: "station-link", text: r.station.name,
        onclick: () => { update({ station: r.station.code, page }); $("station-detail").scrollIntoView({ block: "nearest" }); } })]),
      node("td", { text: r.station.brand }), node("td", { text: r.station.municipality }), node("td", { text: r.station.locality ?? "" }),
      node("td", { text: r.station.type }), node("td", { class: "num", text: formatPrice(r.price, f.unit) }),
      node("td", { text: r.updatedAt ? LISBON_TIME.format(new Date(r.updatedAt)) : "–" }),
    ]));
  $("stations-table").replaceChildren(node("table", {}, [node("thead", {}, [head]), node("tbody", {}, body)]));
  $("pager").replaceChildren(
    node("button", { type: "button", text: "Anterior", ...(page === 0 ? { disabled: "" } : {}), onclick: () => update({ page: page - 1 }) }),
    node("span", { text: `Página ${page + 1} de ${pages}` }),
    node("button", { type: "button", text: "Seguinte", ...(page >= pages - 1 ? { disabled: "" } : {}), onclick: () => update({ page: page + 1 }) }),
  );
}

// ---------- movers ----------
function renderMoversCard(pairs) {
  const f = fuel();
  const ref = referenceIndex(model.dates, COMPARE_DAYS);
  const box = $("movers");
  if (ref === null) {
    $("movers-note").textContent = "";
    box.replaceChildren(node("p", { class: "empty", text: `Comparação disponível quando houver ${COMPARE_DAYS + 1} dias de dados.` }));
    return;
  }
  const all = movers(pairs, model.stations, model.latestIndex, ref);
  $("movers-note").textContent = `${formatDate(model.dates[ref])} → ${formatDate(model.coverage.latest_date)} · postos que publicaram nos dois dias · ${all.length} mudaram de preço`;
  const table = (title, list) => node("div", { class: "movers" }, [
    node("h3", { text: title }),
    list.length === 0 ? node("p", { class: "empty", text: "Nenhum posto." }) : simpleTable(
      ["Posto", "Concelho", "Antes", "Agora", "Variação"],
      list.map((m) => [m.station.name, m.station.municipality, formatPrice(m.before, f.unit), formatPrice(m.now, f.unit), formatDelta(m.change, f.unit)]),
      [2, 3, 4],
    ),
  ]);
  box.replaceChildren(
    table("Maiores subidas", all.filter((m) => m.change > 0).slice(0, MOVERS_SHOWN)),
    table("Maiores descidas", all.filter((m) => m.change < 0).slice(0, MOVERS_SHOWN)),
  );
}

function simpleTable(headers, rows, numericCols = []) {
  return node("div", { class: "table-wrap" }, [node("table", {}, [
    node("thead", {}, [node("tr", {}, headers.map((h, i) => node("th", { scope: "col", class: numericCols.includes(i) ? "num" : "", text: h })))]),
    node("tbody", {}, rows.map((r) => node("tr", {}, r.map((v, i) => node("td", { class: numericCols.includes(i) ? "num" : "", text: v }))))),
  ])]);
}

// ---------- main ----------
function render() {
  hideTooltip();
  syncFilters();
  const pairs = filterPairs(model, state);
  renderTiles();
  renderStats(pairs);
  renderTrendCard(pairs);
  renderAreasCard(pairs);
  renderMapCard(pairs);
  renderStationDetail();
  renderStationsCard(pairs);
  renderMoversCard(pairs);
}

function fail(message) {
  const status = $("status");
  status.textContent = message;
  status.classList.add("error");
  $("meta").textContent = "";
}

async function start() {
  let payload;
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch {
    fail("Não foi possível carregar os dados. Tente novamente dentro de alguns minutos.");
    return;
  }
  if (payload.schema_version !== SUPPORTED_SCHEMA || !payload.dates?.length) {
    fail("Os dados disponíveis estão num formato inesperado. Tente novamente mais tarde.");
    return;
  }
  model = loadModel(payload);
  readUrl();
  fillFilters();
  renderMeta();
  $("status").hidden = true;
  $("app").hidden = false;
  render();
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return; // mobile browsers fire resize when the toolbar hides
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, RESIZE_DEBOUNCE_MS);
  });
}

start();
