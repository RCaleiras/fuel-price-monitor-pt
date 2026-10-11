// Tests for site/lib.js (pure dashboard logic). Run: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareDays,
  filterPairs,
  formatDate,
  formatPrice,
  groupSummary,
  loadModel,
  movers,
  quantile,
  referenceIndex,
  seriesByDay,
  staleDays,
  summarize,
} from "../../site/lib.js";

function buildDates(start, n) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const payload = {
  dates: buildDates("2026-10-04", 8),
  fuels: [
    { id: 5, name: "Gasóleo simples", unit: "litro", fleet: true },
    { id: 3, name: "GNL", unit: "kg", fleet: false },
  ],
  stations: {
    fields: ["code", "name", "type", "brand", "district", "municipality", "locality", "address", "lat", "lon"],
    rows: [
      [101, "A", "Outro", "GALP", "Faro", "Faro", "Faro", "R1", 37.0, -7.9],
      [202, "B", "Outro", "BP", "Faro", "Loulé", "Loulé", "R2", 37.1, -8.0],
      [303, "C", "Auto-estrada", "REPSOL", "Lisboa", "Lisboa", "Lisboa", "R3", 38.7, -9.1],
    ],
  },
  prices: {
    fields: ["station", "fuel", "prices", "updated_at"],
    rows: [
      [0, 5, [2000, null, null, null, null, null, null, 2100], "2026-10-11T08:00:00Z"],
      [1, 5, [2200, null, null, null, null, null, null, 2150], null],
      [2, 5, [null, null, null, null, null, null, null, 2300], null],
      [2, 3, [null, null, null, null, null, null, null, 3279], null],
    ],
  },
  activity: [],
  coverage: { first_date: "2026-10-04", latest_date: "2026-10-11", n_days: 8 },
};

const model = loadModel(payload);
const diesel = (filters = {}) => filterPairs(model, { fuel: 5, ...filters });

test("quantile interpolates like PERCENTILE_CONT", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.ok(Math.abs(quantile([1, 2, 3, 4], 0.1) - 1.3) < 1e-12);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([], 0.5), null);
});

test("summarize returns null for no values and exact stats otherwise", () => {
  assert.equal(summarize([]), null);
  const s = summarize([2300, 2100, 2150]);
  assert.deepEqual([s.n, s.median, s.min, s.max], [3, 2150, 2100, 2300]);
  assert.ok(Math.abs(s.mean - 6550 / 3) < 1e-9);
  assert.ok(Math.abs(s.p10 - 2110) < 1e-9);
  assert.ok(Math.abs(s.p90 - 2270) < 1e-9);
});

test("loadModel turns rows into named objects and indexes fuels", () => {
  assert.equal(model.stations[2].municipality, "Lisboa");
  assert.equal(model.fuels.get(3).unit, "kg");
  assert.equal(model.pairs.length, 4);
  assert.equal(model.latestIndex, 7);
});

test("filterPairs applies fuel, district and municipality together", () => {
  assert.equal(diesel().length, 3);
  assert.equal(diesel({ district: "Faro" }).length, 2);
  assert.equal(diesel({ district: "Faro", municipality: "Loulé" }).length, 1);
  assert.equal(filterPairs(model, { fuel: 3 }).length, 1);
  assert.equal(diesel({ district: "Porto" }).length, 0);
});

test("seriesByDay skips days with no published price", () => {
  const series = seriesByDay(diesel(), payload.dates.length);
  assert.equal(series[1], null);
  assert.equal(series[0].n, 2);
  assert.equal(series[7].median, 2150);
});

test("referenceIndex finds the day 7 days before the latest, or null", () => {
  assert.equal(referenceIndex(payload.dates, 7), 0);
  assert.equal(referenceIndex(payload.dates.slice(1), 7), null);
});

test("compareDays reports medians, delta and percent change", () => {
  const cmp = compareDays(diesel(), 7, 0);
  assert.equal(cmp.current.median, 2150);
  assert.equal(cmp.reference.median, 2100);
  assert.equal(cmp.delta, 50);
  assert.ok(Math.abs(cmp.deltaPct - 50 / 2100) < 1e-12);
});

test("compareDays has no delta when the reference day is missing or empty", () => {
  assert.equal(compareDays(diesel(), 7, null).delta, null);
  assert.equal(compareDays(diesel(), 7, 1).delta, null);
  assert.equal(compareDays(diesel({ district: "Porto" }), 7, 0).current, null);
});

test("groupSummary groups the latest day by district, cheapest first", () => {
  const groups = groupSummary(diesel(), model.stations, 7, "district");
  assert.deepEqual(groups.map((g) => [g.key, g.n, g.median]), [["Faro", 2, 2125], ["Lisboa", 1, 2300]]);
});

test("movers compares stations published on both days only, biggest change first", () => {
  const result = movers(diesel(), model.stations, 7, 0);
  assert.deepEqual(result.map((m) => [m.station.code, m.change]), [[101, 100], [202, -50]]);
});

test("formatPrice and formatDate use Portuguese conventions", () => {
  assert.equal(formatPrice(2207, "litro"), "2,207 €/l");
  assert.equal(formatPrice(3279, "kg"), "3,279 €/kg");
  assert.equal(formatPrice(null, "litro"), "sem dados");
  assert.equal(formatDate("2026-10-11"), "11/10/2026");
});

test("staleDays counts whole days between the data day and today (UTC)", () => {
  assert.equal(staleDays("2026-10-11", new Date("2026-10-11T20:00:00Z")), 0);
  assert.equal(staleDays("2026-10-11", new Date("2026-10-14T01:00:00Z")), 3);
});
