// Tests for site/model.js (derived data, state, URL) and site/story.js (generated sentences). Run: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadModel } from "../../site/lib.js";
import {
  DEFAULT_STATE, brandLabel, createData, createStore, fuelLabel, paramsFromState, stateFromParams, typeLabel,
} from "../../site/model.js";
import { compareSentence, summarySegments } from "../../site/story.js";

function buildDates(start, n) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// 8 days; diesel published by four stations on day 0 and day 7, by one station on day 3.
const payload = {
  dates: buildDates("2026-10-04", 8),
  generated_at: "2026-10-11T14:00:00Z",
  fuels: [
    { id: 5, name: "Gasóleo simples", unit: "litro", fleet: true },
    { id: 1, name: "GPL Auto", unit: "litro", fleet: true },
    { id: 4, name: "GNC (gás natural comprimido) - €/kg", unit: "kg", fleet: false },
  ],
  stations: {
    fields: ["code", "name", "type", "brand", "district", "municipality", "locality", "address", "lat", "lon"],
    rows: [
      [101, "Posto Água", "Outro", "GALP", "Faro", "Faro", "Faro", "R1", 37.0, -7.9],
      [202, "Posto B", "Outro", "PETROPRIX ", "Faro", "Loulé", "Quarteira", "R2", 37.1, -8.0],
      [303, "A2 Norte", "Auto-estrada", "REPSOL", "Lisboa", "Lisboa", "Lisboa", "R3", 38.7, -9.1],
      [404, "Posto D", "Outro", "GALP", "Lisboa", "Sintra", "Sintra", "R4", 38.8, -9.3],
    ],
  },
  prices: {
    fields: ["station", "fuel", "prices", "updated_at"],
    rows: [
      [0, 5, [2000, null, null, 2050, null, null, null, 2100], "2026-10-11T08:00:00Z"],
      [1, 5, [2200, null, null, null, null, null, null, 2150], null],
      [2, 5, [2300, null, null, null, null, null, null, 2300], null],
      [3, 5, [2100, null, null, null, null, null, null, 2000], null],
      [0, 1, [990, null, null, null, null, null, null, 1000], null],
    ],
  },
  activity: [{ fuel: 5, date: "2026-10-11", published: 4, carried: 1, changes: 3, suspect: 0 }],
  coverage: { first_date: "2026-10-04", latest_date: "2026-10-11", n_days: 8 },
};

const data = createData(loadModel(payload));
const base = { ...DEFAULT_STATE, fuel: 5 };
const join = (segments) => segments.map((s) => s.text).join("");

test("fuel and station type labels are English, DGEG names are kept", () => {
  assert.equal(fuelLabel({ name: "Gasóleo simples", unit: "litro" }).label, "Diesel");
  assert.equal(fuelLabel({ name: "GNC (gás natural comprimido) - €/kg", unit: "kg" }).label, "CNG (per kg)");
  assert.equal(fuelLabel({ name: "Something new", unit: "litro" }).label, "Something new");
  assert.equal(typeLabel("Auto-estrada"), "Motorway");
  assert.equal(typeLabel("Desconhecido"), "Desconhecido");
  assert.equal(brandLabel("PETROPRIX "), "PETROPRIX");
  assert.equal(data.defaultFuel.label, "Diesel");
  assert.equal(data.fuelById.get(5).name, "Gasóleo simples");
});

test("kpi compares with 7 days earlier and explains when it cannot", () => {
  const k = data.kpi(base, 5);
  assert.equal(k.current.median, 2125);
  assert.equal(k.reference.median, 2150);
  assert.equal(k.delta, -25);
  assert.equal(k.comparable, true);
  const early = data.kpi({ ...base, day: 3 }, 5);
  assert.equal(early.comparable, false);
  assert.match(early.reason, /^No comparison: no data for 30 Sept?$/);
});

test("kpi hides the change when station coverage differs by more than 20%", () => {
  const sparse = createData(loadModel({ ...payload, prices: { ...payload.prices, rows: [
    [0, 5, [2000, null, null, null, null, null, null, 2100], null],
    [1, 5, [2200, null, null, null, null, null, null, null], null],
    [2, 5, [2300, null, null, null, null, null, null, null], null],
  ] } }));
  const k = sparse.kpi(base, 5);
  assert.equal(k.delta, -100);
  assert.equal(k.comparable, false);
  assert.equal(k.reason, "Not comparable: 1 vs 3 stations");
});

test("brand and type filters narrow every view; groups ignore their own dimension", () => {
  const galp = { ...base, brand: "GALP" };
  assert.equal(data.scopeSummary(galp).n, 2);
  const byType = data.groups({ ...base, type: "Auto-estrada", groupBy: "type" });
  assert.deepEqual(byType.rows.map((r) => [r.label, r.n]), [["Other", 3], ["Motorway", 1]]);
  const byBrand = data.groups({ ...galp, groupBy: "brand" });
  assert.equal(byBrand.rows.length, 0); // every brand has fewer than 10 stations here
  assert.equal(byBrand.hiddenCount, 3);
  assert.equal(data.groups({ ...base, district: "Faro" }).key, "municipality");
});

test("station rows search without accents, sort, and show the gap to the median", () => {
  const rows = data.stationRows({ ...base, search: "agua" });
  assert.deepEqual(rows.map((r) => r.station.code), [101]);
  assert.equal(rows[0].vsMedian, 2100 - 2125);
  const dearFirst = data.stationRows({ ...base, sort: { key: "price", dir: -1 } });
  assert.equal(dearFirst[0].station.code, 303);
  const historical = data.stationRows({ ...base, day: 0 });
  assert.equal(historical.every((r) => r.updatedAt === null), true);
});

test("station detail lists every fuel and the district median", () => {
  const d = data.stationDetail(base, 101);
  assert.deepEqual(d.rows.map((r) => [r.fuel.label, r.price]), [["Diesel", 2100], ["LPG (Autogas)", 1000]]);
  assert.equal(d.districtMedian, 2125);
  assert.equal(data.stationDetail(base, 999), null);
});

test("week movers need the day 7 days earlier", () => {
  const m = data.weekMovers(base);
  assert.equal(m.available, true);
  assert.deepEqual(m.list.map((r) => [r.station.code, r.change]), [[101, 100], [404, -100], [202, -50]]);
  assert.equal(data.weekMovers({ ...base, day: 3 }).available, false);
});

test("store: changing district clears the municipality and resets the page", () => {
  const store = createStore({ ...base, district: "Faro", municipality: "Loulé", page: 3 });
  store.set({ district: "Lisboa" });
  assert.deepEqual([store.get().district, store.get().municipality, store.get().page], ["Lisboa", "", 0]);
  store.set({ page: 2 });
  store.set({ groupBy: "brand" });
  assert.equal(store.get().page, 2);
});

test("URL state round-trips and rejects unknown values", () => {
  const state = { ...base, district: "Faro", municipality: "Loulé", brand: "PETROPRIX ", type: "Outro", range: "7", day: 3,
    groupBy: "brand", station: 202, search: "posto", sort: { key: "name", dir: -1 } };
  const back = stateFromParams(paramsFromState(state, data), data);
  for (const key of ["fuel", "district", "municipality", "brand", "type", "range", "day", "groupBy", "station", "search"]) {
    assert.deepEqual(back[key], state[key], key);
  }
  assert.deepEqual(back.sort, state.sort);
  const junk = stateFromParams(new URLSearchParams("fuel=999&district=Atlantis&days=14&day=2020-01-01&group=x&station=1"), data);
  assert.deepEqual([junk.fuel, junk.district, junk.range, junk.day, junk.groupBy, junk.station], [5, "", "all", null, "region", null]);
  assert.equal(stateFromParams(new URLSearchParams("day=2026-10-11"), data).day, null); // the latest day is not "historical"
  assert.equal(paramsFromState(base, data).toString(), "fuel=5");
});

test("old Portuguese links still open the same view", () => {
  const s = stateFromParams(new URLSearchParams("combustivel=1&distrito=Faro&concelho=Loul%C3%A9&periodo=7"), data);
  assert.deepEqual([s.fuel, s.district, s.municipality, s.range], [1, "Faro", "Loulé", "7"]);
});

test("summary sentence states the median, the weekly change and the station count", () => {
  assert.equal(join(summarySegments(data, base)), "Diesel cost a median €2.125 a litre in mainland Portugal on 11 Oct 2026, "
    + "the latest day collected, €0.025 less than a week earlier (−1.2%). Based on 4 stations.");
  assert.equal(summarySegments(data, base).filter((s) => s.strong).length, 2);
  assert.match(join(summarySegments(data, { ...base, day: 3 })), /\(no week-on-week comparison: no data for 30 Sept?\)\. Based on 1 station\.$/);
  assert.match(join(summarySegments(data, { ...base, district: "Faro", brand: "REPSOL" })), /^No station published a Diesel price in Faro district at REPSOL/);
});

test("comparison sentence names cheapest and dearest with their station counts", () => {
  assert.equal(compareSentence(data, base),
    "The cheapest district is Faro (median €2.125, 2 stations); the dearest is Lisboa (€2.150, 2 stations): a gap of €0.025 a litre.");
  assert.equal(compareSentence(data, { ...base, municipality: "Faro", district: "Faro" }), "Only one locality has prices for this selection.");
});

test("compare mode follows the selected fuel's unit and keeps the reader's visibility choices", async () => {
  const { compareSet, selectFuel } = await import("../../site/ui.js");
  assert.deepEqual(compareSet(data, 5), { compare: [5, 1], hidden: [1] });
  const store = createStore({ ...base, ...compareSet(data, 5) });
  store.set({ hidden: [] }); // the reader turned LPG on
  selectFuel(data, store, 1);
  assert.deepEqual([store.get().fuel, store.get().compare, store.get().hidden], [1, [5, 1], []]);
  selectFuel(data, store, 4); // CNG is sold per kg: litre fuels leave the chart
  assert.deepEqual([store.get().fuel, store.get().compare, store.get().hidden], [4, [4], []]);
  const single = createStore(base);
  selectFuel(data, single, 1);
  assert.deepEqual([single.get().fuel, single.get().compare], [1, []]);
});

// ---------- Phase 1: up to 90 days of per-station history ----------

function payloadWithDays(n) {
  const dates = buildDates("2026-07-14", n);
  const rising = (v) => Array.from({ length: n }, (_, i) => v + i);
  return {
    ...payload,
    dates,
    // each series rises by 1 milli-euro per day, so the change over 7 days is exactly +7
    prices: { fields: payload.prices.fields, rows: payload.prices.rows.map((r) => [r[0], r[1], rising(r[2][0]), r[3]]) },
    coverage: { first_date: dates[0], latest_date: dates[n - 1], n_days: n },
  };
}

test("period options follow the days available: 14 and 30 wait for data, All shows every day up to 90", () => {
  const few = createData(loadModel(payloadWithDays(12))).rangeOptions();
  assert.deepEqual(few.map((o) => [o.value, o.disabled]), [["7", false], ["14", true], ["30", true], ["all", false]]);
  assert.equal(few.at(-1).label, "All (12 days)");

  const full = createData(loadModel(payloadWithDays(90))).rangeOptions();
  assert.ok(full.every((o) => !o.disabled));
  assert.equal(full.at(-1).label, "All (90 days)");
});

test("with 90 days the trend and the station history cover every day and the 7-day change is exact", () => {
  const long = createData(loadModel(payloadWithDays(90)));
  const trend = long.trend({ ...DEFAULT_STATE, fuel: 5 }, [5]);
  assert.equal(trend.dates.length, 90);
  assert.equal(trend.series[0].points.length, 90);

  const last30 = long.trend({ ...DEFAULT_STATE, fuel: 5, range: "30" }, [5]);
  assert.equal(last30.dates.length, 30);
  assert.equal(last30.dates.at(-1), "2026-10-11");

  const k = long.kpi({ ...DEFAULT_STATE, fuel: 5 }, 5);
  assert.equal(k.current.n, 4);
  assert.equal(k.refIso, "2026-10-04");
  assert.equal(k.delta, 7);
  assert.equal(k.comparable, true);

  const detail = long.stationDetail({ ...DEFAULT_STATE, fuel: 5 }, 101);
  assert.equal(detail.history.length, 90);
  assert.equal(detail.history[89] - detail.history[0], 89);
});

test("fitDay: a period that no longer contains the inspected day sends the page back to the latest day", () => {
  const data = createData(loadModel(payload));
  const store = createStore({ ...base, range: "all", day: 1 }, data.fitDay);
  assert.equal(store.get().day, 1);

  store.set({ range: "7" }); // 8 days collected: the 7-day period starts at index 1
  assert.equal(store.get().day, 1, "the first day of the period is still inside it");

  store.set({ range: "all", day: 0 });
  store.set({ range: "7" });
  assert.equal(store.get().day, null, "day 0 is before the 7-day period");
  assert.equal(data.isLatest(store.get()), true);
});

test("fitDay: a shared link whose day is outside its period opens on the latest day", () => {
  const data = createData(loadModel(payload));
  const state = stateFromParams(new URLSearchParams(`days=7&day=${payload.dates[0]}`), data);
  const store = createStore(state, data.fitDay);

  assert.equal(store.get().day, null);
  assert.equal(store.get().range, "7");
});

test("fitDay: a day inside the period, or no day, is left alone", () => {
  const data = createData(loadModel(payload));
  const inside = { ...base, range: "7", day: 3 };
  const latest = { ...base, range: "7", day: null };

  assert.equal(data.fitDay(inside), inside);
  assert.equal(data.fitDay(latest), latest);
});
