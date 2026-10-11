// Derived dashboard data and state: English labels, filters, KPIs, groups, table rows, URL state. No DOM.
// Every number comes from the calculation rules in lib.js; this module only selects which prices they run on.
// Tested by tests/js/model.test.mjs.
import {
  compareDays, dayValues, filterPairs, formatCount, formatDay, groupSummary, movers, referenceFor, seriesByDay, summarize,
} from "./lib.js";

export const COMPARE_DAYS = 7;
// The 7-day change compares two medians; if the number of stations differs a lot between the two days, the change
// would reflect which stations published, not prices. Then it is hidden (same rule since the first dashboard).
const MIN_COVERAGE_RATIO = 0.8;
export const MIN_BRAND_STATIONS = 10; // brand comparison: a median of a handful of stations is not plotted
export const RANGE_OPTIONS = [7, 14, 30];

// ---------- English labels (display only; DGEG names stay in the data and are shown as the original) ----------
const FUEL_LABELS = {
  "Gasóleo simples": { label: "Diesel", short: "Diesel", family: "diesel", premium: false, order: 1 },
  "Gasolina simples 95": { label: "Petrol 95", short: "P95", family: "p95", premium: false, order: 2 },
  "Gasóleo especial": { label: "Premium diesel", short: "Prem. diesel", family: "diesel", premium: true, order: 3 },
  "Gasolina especial 95": { label: "Premium petrol 95", short: "Prem. P95", family: "p95", premium: true, order: 4 },
  "Gasolina 98": { label: "Petrol 98", short: "P98", family: "p98", premium: false, order: 5 },
  "Gasolina especial 98": { label: "Premium petrol 98", short: "Prem. P98", family: "p98", premium: true, order: 6 },
  "GPL Auto": { label: "LPG (Autogas)", short: "LPG", family: "lpg", premium: false, order: 7 },
  "Gasóleo colorido": { label: "Coloured diesel (agricultural)", short: "Col. diesel", family: "other", premium: false, order: 20 },
  "Gasolina de mistura (motores a 2 tempos)": { label: "Two-stroke petrol mix", short: "2T mix", family: "other", premium: false, order: 21 },
};
const STATION_TYPES = { "Outro": "Other", "Auto-estrada": "Motorway", "Área comercial (Hipermercados)": "Hypermarket" };
const DEFAULT_FUEL_NAME = "Gasóleo simples";

export function fuelLabel(fuel) {
  const known = FUEL_LABELS[fuel.name];
  if (known) return known;
  if (fuel.name.startsWith("GNC")) return { label: `CNG (per ${fuel.unit === "m3" ? "m³" : "kg"})`, short: "CNG", family: "other", premium: false, order: 22 };
  if (fuel.name.startsWith("GNL")) return { label: "LNG (per kg)", short: "LNG", family: "other", premium: false, order: 24 };
  return { label: fuel.name, short: fuel.name, family: "other", premium: false, order: 30 };
}

export const typeLabel = (type) => STATION_TYPES[type] ?? type;
export const brandLabel = (brand) => String(brand ?? "").trim();

export function areaLabel(state) {
  if (state.municipality) return `${state.municipality} (${state.district})`;
  if (state.district) return `${state.district} district`;
  return "mainland Portugal";
}

// ---------- state ----------
export const DEFAULT_STATE = Object.freeze({
  fuel: null, compare: [], hidden: [], district: "", municipality: "", brand: "", type: "",
  range: "all", day: null, groupBy: "region", station: null, search: "", sort: { key: "price", dir: 1 }, page: 0,
});
const RESETS_PAGE = ["fuel", "district", "municipality", "brand", "type", "range", "day", "search"];
export const RESET_PATCH = Object.freeze({ district: "", municipality: "", brand: "", type: "", range: "all", day: null, search: "", station: null });

/** A tiny store: immutable snapshots, one subscriber list. Changing the district clears the municipality. */
export function createStore(initial) {
  let state = Object.freeze({ ...initial });
  const subscribers = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      if ("district" in patch && !("municipality" in patch)) next.municipality = "";
      if (RESETS_PAGE.some((k) => k in patch) && !("page" in patch)) next.page = 0;
      state = Object.freeze(next);
      for (const fn of subscribers) fn(state, patch);
    },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}

// ---------- derived data ----------
export function createData(model) {
  const collator = new Intl.Collator("pt", { sensitivity: "base", numeric: true });
  const fuels = [...model.fuels.values()]
    .map((f) => ({ ...f, ...fuelLabel(f) }))
    .sort((a, b) => a.order - b.order || collator.compare(a.label, b.label));
  const fuelById = new Map(fuels.map((f) => [f.id, f]));
  const fleet = fuels.filter((f) => f.fleet);
  const defaultFuel = fuels.find((f) => f.name === DEFAULT_FUEL_NAME) ?? fuels[0];
  const latest = model.latestIndex;
  const dates = model.dates;

  const countBy = (key) => {
    const m = new Map();
    for (const s of model.stations) m.set(s[key], (m.get(s[key]) ?? 0) + 1);
    return m;
  };
  const brands = [...countBy("brand").entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(brandLabel(a[0]), brandLabel(b[0])))
    .map(([value, n]) => ({ value, label: brandLabel(value), n }));
  const types = [...countBy("type").entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: typeLabel(value), n }));
  const districts = [...new Set(model.stations.map((s) => s.district))].sort(collator.compare);
  const municipalityCache = new Map();

  const dayIndex = (state) => (state.day === null ? latest : state.day);
  const isLatest = (state) => state.day === null || state.day === latest;

  function municipalities(district) {
    if (!municipalityCache.has(district)) {
      municipalityCache.set(district, [...new Set(model.stations.filter((s) => s.district === district).map((s) => s.municipality))].sort(collator.compare));
    }
    return municipalityCache.get(district);
  }

  function pairs(state, fuelId = state.fuel) {
    const base = filterPairs(model, { fuel: fuelId, district: state.district, municipality: state.municipality });
    if (!state.brand && !state.type) return base;
    return base.filter((p) => (!state.brand || p.station.brand === state.brand) && (!state.type || p.station.type === state.type));
  }

  /** Median on the inspected day vs 7 days earlier, with the reason when there is no reliable comparison. */
  function kpi(state, fuelId) {
    const idx = dayIndex(state);
    const ref = referenceFor(dates, idx, COMPARE_DAYS);
    const fuelPairs = pairs(state, fuelId);
    const cmp = compareDays(fuelPairs, idx, ref.index);
    let reason = "";
    let comparable = cmp.delta !== null;
    if (ref.index === null) reason = `No comparison: no data for ${formatDay(ref.iso)}`;
    else if (cmp.delta === null) reason = `No prices on ${formatDay(ref.iso)}`;
    else {
      const ratio = cmp.current.n / cmp.reference.n;
      if (ratio < MIN_COVERAGE_RATIO || ratio > 1 / MIN_COVERAGE_RATIO) {
        comparable = false;
        reason = `Not comparable: ${formatCount(cmp.current.n)} vs ${formatCount(cmp.reference.n)} stations`;
      }
    }
    return { fuel: fuelById.get(fuelId), ...cmp, comparable, reason, refIso: ref.iso, dayIso: dates[idx],
      series: seriesByDay(fuelPairs, dates.length) };
  }

  const windowStart = (state) => (state.range === "all" ? 0 : Math.max(0, dates.length - Number(state.range)));

  function rangeOptions() {
    const n = dates.length;
    return [
      ...RANGE_OPTIONS.map((d) => ({ value: String(d), label: `${d} days`, disabled: n < d,
        hint: n < d ? `Available once ${d} days are collected (${n} so far)` : "" })),
      { value: "all", label: `All (${n} days)`, disabled: false, hint: "" },
    ];
  }

  function trend(state, fuelIds) {
    const start = windowStart(state);
    return {
      start,
      dates: dates.slice(start),
      series: fuelIds.map((id) => ({ fuel: fuelById.get(id), points: seriesByDay(pairs(state, id), dates.length).slice(start) })),
    };
  }

  function groupKey(state) {
    if (state.groupBy === "brand") return "brand";
    if (state.groupBy === "type") return "type";
    return state.municipality ? "locality" : state.district ? "municipality" : "district";
  }

  /** The state a group is computed in: brand and type groups ignore their own filter so the selection is seen in context. */
  function groupContext(state) {
    const key = groupKey(state);
    return key === "brand" ? { ...state, brand: "" } : key === "type" ? { ...state, type: "" } : state;
  }

  function groups(state) {
    const key = groupKey(state);
    const all = groupSummary(pairs(groupContext(state)), model.stations, dayIndex(state), key);
    if (key === "brand") {
      const shown = all.filter((g) => g.n >= MIN_BRAND_STATIONS);
      return { key, rows: shown.map((g) => ({ ...g, label: brandLabel(g.key) })), hiddenCount: all.length - shown.length };
    }
    return { key, rows: all.map((g) => ({ ...g, label: key === "type" ? typeLabel(g.key) : String(g.key) })), hiddenCount: 0 };
  }

  const scopeSummary = (state) => summarize(dayValues(pairs(state), dayIndex(state)));

  function stationRows(state) {
    const idx = dayIndex(state);
    const fold = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = fold(state.search.trim());
    const median = scopeSummary(state)?.median ?? null;
    let rows = pairs(state)
      .filter((p) => p.prices[idx] !== null && p.prices[idx] !== undefined)
      .map((p) => ({ station: p.station, price: p.prices[idx], vsMedian: median === null ? null : p.prices[idx] - median,
        updatedAt: isLatest(state) ? p.updatedAt : null }));
    if (needle) {
      rows = rows.filter((r) => [r.station.name, r.station.brand, r.station.locality, r.station.municipality, r.station.address]
        .some((v) => fold(v).includes(needle)));
    }
    const getters = {
      name: (r) => r.station.name, brand: (r) => brandLabel(r.station.brand), place: (r) => `${r.station.municipality} ${r.station.locality ?? ""}`,
      type: (r) => typeLabel(r.station.type), price: (r) => r.price, vsMedian: (r) => r.vsMedian ?? 0, updated: (r) => r.updatedAt ?? "",
    };
    const get = getters[state.sort.key] ?? getters.price;
    const numeric = ["price", "vsMedian"].includes(state.sort.key);
    return rows.sort((a, b) => {
      const cmp = numeric ? get(a) - get(b) : collator.compare(String(get(a)), String(get(b)));
      return cmp * state.sort.dir || a.price - b.price;
    });
  }

  function mapPoints(state) {
    const idx = dayIndex(state);
    return pairs(state).filter((p) => p.prices[idx] !== null && p.prices[idx] !== undefined && p.station.lat !== null && p.station.lon !== null)
      .map((p) => ({ station: p.station, price: p.prices[idx] }));
  }

  /** Every fuel a station published on the inspected day, its history for the selected fuel and its district median. */
  function stationDetail(state, code) {
    const idx = dayIndex(state);
    const list = model.pairs.filter((p) => p.station.code === code);
    if (list.length === 0) return null;
    const rows = list.map((p) => ({ fuel: fuelById.get(p.fuel), price: p.prices[idx] ?? null, updatedAt: isLatest(state) ? p.updatedAt : null }))
      .sort((a, b) => a.fuel.order - b.fuel.order);
    const current = list.find((p) => p.fuel === state.fuel);
    const district = summarize(dayValues(filterPairs(model, { fuel: state.fuel, district: list[0].station.district }), idx));
    return { station: list[0].station, rows, history: current ? current.prices : null, districtMedian: district?.median ?? null };
  }

  /** Stations whose price changed in the 7 days to the inspected day, with the reference date (null when outside the data). */
  function weekMovers(state) {
    const idx = dayIndex(state);
    const ref = referenceFor(dates, idx, COMPARE_DAYS);
    return { refIso: ref.iso, available: ref.index !== null, list: movers(pairs(state), model.stations, idx, ref.index) };
  }

  function activity(state) {
    return model.activity.find((a) => a.fuel === state.fuel && a.date === dates[dayIndex(state)]) ?? null;
  }

  return {
    model, fuels, fleet, fuelById, defaultFuel, brands, types, districts, latest, dates,
    coverage: model.coverage, generatedAt: model.generated_at,
    dayIndex, isLatest, pairs, kpi, trend, rangeOptions, windowStart, groups, groupKey, groupContext, scopeSummary,
    stationRows, mapPoints, stationDetail, weekMovers, activity, municipalities,
  };
}

// ---------- URL state (shareable links) ----------
// English parameter names; the Portuguese names of the first dashboard are still read so old links keep working.
const LEGACY = { fuel: "combustivel", district: "distrito", municipality: "concelho" };
const GROUPS = new Set(["region", "brand", "type"]);
const SORT_KEYS = new Set(["name", "brand", "place", "type", "price", "vsMedian", "updated"]);
const MAX_SEARCH_CHARS = 80;

/** URL -> state, validating every value against the data (unknown values fall back to the defaults). */
export function stateFromParams(params, data) {
  const get = (key) => params.get(key) ?? (LEGACY[key] ? params.get(LEGACY[key]) : null);
  const fuelId = Number(get("fuel"));
  const fuel = data.fuelById.has(fuelId) ? fuelId : data.defaultFuel.id;
  const district = data.districts.includes(get("district")) ? get("district") : "";
  const municipality = district && data.municipalities(district).includes(get("municipality")) ? get("municipality") : "";
  const brand = data.brands.some((b) => b.value === get("brand")) ? get("brand") : "";
  const type = data.types.some((t) => t.value === get("type")) ? get("type") : "";
  const days = params.get("days") ?? (params.get("periodo") === "7" ? "7" : null);
  const range = data.rangeOptions().some((o) => o.value === days && !o.disabled) ? days : "all";
  const dayPos = data.dates.indexOf(params.get("day"));
  const day = dayPos === -1 || dayPos === data.latest ? null : dayPos;
  const groupBy = GROUPS.has(params.get("group")) ? params.get("group") : "region";
  const sortKey = params.get("sort");
  const sort = SORT_KEYS.has(sortKey) ? { key: sortKey, dir: params.get("dir") === "desc" ? -1 : 1 } : DEFAULT_STATE.sort;
  const stationCode = Number(params.get("station"));
  const station = params.has("station") && data.model.pairs.some((p) => p.station.code === stationCode) ? stationCode : null;
  return { ...DEFAULT_STATE, fuel, district, municipality, brand, type, range, day, groupBy, sort, station,
    search: (params.get("q") ?? "").slice(0, MAX_SEARCH_CHARS) };
}

/** state -> URL parameters; defaults are left out so links stay short. */
export function paramsFromState(state, data) {
  const q = new URLSearchParams();
  q.set("fuel", String(state.fuel));
  if (state.district) q.set("district", state.district);
  if (state.municipality) q.set("municipality", state.municipality);
  if (state.brand) q.set("brand", state.brand);
  if (state.type) q.set("type", state.type);
  if (state.range !== "all") q.set("days", state.range);
  if (!data.isLatest(state)) q.set("day", data.dates[state.day]);
  if (state.groupBy !== "region") q.set("group", state.groupBy);
  if (state.sort.key !== "price" || state.sort.dir !== 1) { q.set("sort", state.sort.key); q.set("dir", state.sort.dir === 1 ? "asc" : "desc"); }
  if (state.station !== null) q.set("station", String(state.station));
  if (state.search.trim()) q.set("q", state.search.trim());
  return q;
}
