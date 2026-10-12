// Regression tests for the history optimisation in site/model.js and site/lib.js: the results must equal the
// original calculation (every day computed, then sliced), and the unnecessary work must really be skipped.
// ALL DATA HERE IS SYNTHETIC (seeded random walk, not real prices) and exists only for these tests.
// Run: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadModel, seriesByDay } from "../../site/lib.js";
import { DEFAULT_STATE, createData } from "../../site/model.js";

const N_DAYS = 90;
const PERIODS = ["7", "14", "30", "all"];

/** SYNTHETIC payload: 120 stations in 3 districts, two fleet fuels, 90 days, about 5% of days without a price. */
function syntheticPayload() {
  let seed = 20261012;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const dates = [];
  const d = new Date("2026-07-14T00:00:00Z");
  for (let i = 0; i < N_DAYS; i += 1) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  const districts = ["Faro", "Lisboa", "Porto"];
  const brands = ["GALP", "REPSOL", "BP", "CEPSA"];
  const stations = Array.from({ length: 120 }, (_, i) => [
    1000 + i, `Synthetic ${i}`, i % 7 === 0 ? "Auto-estrada" : "Outro", brands[i % brands.length],
    districts[i % districts.length], `Municipality ${i % 9}`, `Locality ${i % 13}`, `Street ${i}`, 37 + rnd(), -9 + rnd(),
  ]);
  const rows = [];
  stations.forEach((_, st) => {
    for (const fuel of [5, 1]) {
      let p = fuel === 5 ? 1650 : 800;
      rows.push([st, fuel, Array.from({ length: N_DAYS }, () => { p += Math.round((rnd() - 0.5) * 10); return rnd() < 0.05 ? null : p; }), null]);
    }
  });
  return {
    synthetic: true,
    dates,
    generated_at: "2026-10-11T14:00:00Z",
    fuels: [
      { id: 5, name: "Gasóleo simples", unit: "litro", fleet: true },
      { id: 1, name: "GPL Auto", unit: "litro", fleet: true },
    ],
    stations: { fields: ["code", "name", "type", "brand", "district", "municipality", "locality", "address", "lat", "lon"], rows: stations },
    prices: { fields: ["station", "fuel", "prices", "updated_at"], rows },
    activity: [],
    coverage: { first_date: dates[0], latest_date: dates[N_DAYS - 1], n_days: N_DAYS },
  };
}

/** The same payload with every price array wrapped so each read of a day is counted (the work done). */
function countedPayload() {
  const payload = syntheticPayload();
  const counter = { reads: 0 };
  const rows = payload.prices.rows.map(([st, fuel, prices, at]) => [st, fuel, new Proxy(prices, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) counter.reads += 1;
      return target[key];
    },
  }), at]);
  return { payload: { ...payload, prices: { ...payload.prices, rows } }, counter };
}

const makeData = (payload = syntheticPayload()) => createData(loadModel(payload));
const stateOf = (data, patch = {}) => ({ ...DEFAULT_STATE, fuel: data.defaultFuel.id, ...patch });

/** The original calculation of a trend: every day computed, then sliced to the period. */
function originalTrendPoints(data, state, fuelId) {
  return seriesByDay(data.pairs(state, fuelId), data.dates.length).slice(data.windowStart(state));
}

test("synthetic fixture is marked synthetic and has the 90 days the tests rely on", () => {
  const payload = syntheticPayload();
  assert.equal(payload.synthetic, true);
  assert.equal(payload.dates.length, N_DAYS);
});

test("seriesByDay(from) equals the full series sliced from that day, including past the end", () => {
  const data = makeData();
  const pairs = data.pairs(stateOf(data));
  const full = seriesByDay(pairs, N_DAYS);
  for (const from of [0, 1, 6, 60, 83, 89, 90, 200]) {
    assert.deepEqual(seriesByDay(pairs, N_DAYS, from), full.slice(from), `from=${from}`);
  }
});

test("trend equals the original calculation for every period, with a cold and a warm cache", () => {
  for (const warm of [false, true]) {
    const data = makeData();
    for (const period of PERIODS) {
      for (const patch of [{}, { district: "Faro" }, { brand: "GALP" }, { type: "Auto-estrada" }]) {
        const state = stateOf(data, { range: period, ...patch });
        if (warm) data.kpi(state, 5).series; // fills the cache the trend may then slice
        const t = data.trend(state, [5, 1]);
        assert.equal(t.start, data.windowStart(state));
        assert.deepEqual(t.dates, data.dates.slice(t.start));
        assert.deepEqual(t.series.map((s) => s.points), [5, 1].map((id) => originalTrendPoints(data, state, id)),
          `period=${period} ${JSON.stringify(patch)} warm=${warm}`);
      }
    }
  }
});

test("kpi series equals the original calculation and follows the filters, never a stale cache", () => {
  const data = makeData();
  const all = stateOf(data);
  const faro = stateOf(data, { district: "Faro" });
  const unfiltered = data.kpi(all, 5).series;
  const filtered = data.kpi(faro, 5).series;
  assert.deepEqual(unfiltered, seriesByDay(data.pairs(all, 5), N_DAYS));
  assert.deepEqual(filtered, seriesByDay(data.pairs(faro, 5), N_DAYS));
  assert.notDeepEqual(unfiltered, filtered);
  assert.deepEqual(data.kpi(all, 5).series, unfiltered); // back to the first filters: same values
});

test("period, day and sort changes do not alter a fuel's series; each createData has its own cache", () => {
  const data = makeData();
  const first = data.kpi(stateOf(data), 5).series;
  const later = data.kpi(stateOf(data, { range: "7", day: 40, sort: { key: "name", dir: -1 } }), 5).series;
  assert.deepEqual(later, first);
  assert.equal(later, first); // the same cached array, not a copy
  const other = makeData(); // same payload, new data object: nothing shared
  assert.notEqual(other.kpi(stateOf(other), 5).series, first);
  assert.deepEqual(other.kpi(stateOf(other), 5).series, first);
});

test("the cached series is frozen, so a caller cannot corrupt what other panels read", () => {
  const data = makeData();
  const series = data.kpi(stateOf(data), 5).series;
  assert.ok(Object.isFrozen(series));
  assert.throws(() => { series.length = 0; }, TypeError);
});

test("work skipped: a 7-day trend reads 7 days of prices, All reads all 90", () => {
  const seven = countedPayload();
  const dataSeven = makeData(seven.payload);
  dataSeven.trend(stateOf(dataSeven, { range: "7" }), [5]);

  const all = countedPayload();
  const dataAll = makeData(all.payload);
  dataAll.trend(stateOf(dataAll, { range: "all" }), [5]);

  const nPairs = dataAll.pairs(stateOf(dataAll), 5).length;
  assert.equal(seven.counter.reads, nPairs * 7);
  assert.equal(all.counter.reads, nPairs * N_DAYS);
});

test("work skipped: kpi alone reads only its two comparison days; the series is paid for when it is read", () => {
  const { payload, counter } = countedPayload();
  const data = makeData(payload);
  const state = stateOf(data);
  const nPairs = data.pairs(state, 5).length;

  const k = data.kpi(state, 5);
  assert.equal(counter.reads, nPairs * 2); // inspected day and the day 7 days earlier
  const afterKpi = counter.reads;
  k.series;
  assert.equal(counter.reads - afterKpi, nPairs * N_DAYS);
});

test("work reused: the same fuel and filters read no prices again, whatever the period or day", () => {
  const { payload, counter } = countedPayload();
  const data = makeData(payload);
  const nPairs = data.pairs(stateOf(data), 5).length;
  data.kpi(stateOf(data), 5).series; // computed once

  const before = counter.reads;
  data.kpi(stateOf(data, { range: "14", day: 40 }), 5).series;
  assert.equal(counter.reads - before, nPairs * 2); // only the two comparison days of the kpi, never the 90-day series
});

test("work reused: a trend drawn after the kpi series slices the cache and reads no prices", () => {
  const { payload, counter } = countedPayload();
  const data = makeData(payload);
  const state = stateOf(data, { range: "7" });
  data.kpi(state, 5).series;

  const before = counter.reads;
  data.trend(state, [5]);
  assert.equal(counter.reads, before);
});
