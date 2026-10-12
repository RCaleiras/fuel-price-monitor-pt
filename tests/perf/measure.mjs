// Browser timing of two builds of the dashboard on the SAME synthetic data, under CPU throttling.
// Local only: it starts its own headless Chrome with a temporary profile and talks to it over the DevTools protocol.
// Usage: node tests/perf/measure.mjs [cpuRate=4] [repetitions=5] [out=result.json]
// Env:   BEFORE_URL, AFTER_URL (default http://127.0.0.1:8101/ and :8102/), CHROME_PATH, DEBUG_PORT (default 9333).
// See tests/perf/README.md. An "interaction" is the time from the event to the second animation frame.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [cpu = "4", reps = "5", out = "result.json"] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.DEBUG_PORT ?? 9333);
const VERSIONS = {
  before: process.env.BEFORE_URL ?? "http://127.0.0.1:8101/",
  after: process.env.AFTER_URL ?? "http://127.0.0.1:8102/",
};
const STEPS_PER_INTERACTION = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const range = (values) => [Math.min(...values), Math.max(...values)];

async function waitForBrowser() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Chrome did not start");
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  const opened = new Promise((resolve) => (ws.onopen = resolve));
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (data) => (data.error ? reject(new Error(data.error.message)) : resolve(data.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { opened, send, close: () => ws.close() };
}

// Runs inside the page once it is ready. Radios are queried again before every click because a change re-renders them.
const INTERACTIONS = `(async () => {
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const timed = async (fn) => { const t0 = performance.now(); fn(); await frames(); return performance.now() - t0; };
  const byId = (id) => document.getElementById(id);
  const setSelect = (s, v) => { s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); };
  const cycle = async (select, n) => {
    const values = [...select.options].map((o) => o.value);
    const times = [];
    for (let i = 0; i < n; i++) {
      const next = values[(values.indexOf(select.value) + 1) % values.length];
      times.push(await timed(() => setSelect(select, next)));
    }
    return times;
  };
  await new Promise((r) => setTimeout(r, 600));
  const fuel = byId("f-fuel");
  const other = [...fuel.options].find((o) => o.value !== fuel.value).value;
  const first = await timed(() => setSelect(fuel, other));
  await frames();
  const fuelTimes = await cycle(fuel, ${STEPS_PER_INTERACTION});
  const periodTimes = [];
  const urls = [location.search];
  for (let i = 0; i < ${STEPS_PER_INTERACTION}; i++) {
    const radios = [...document.querySelectorAll("[data-range-segmented] input[type=radio]:not(:disabled)")];
    const next = radios[(radios.findIndex((r) => r.checked) + 1) % radios.length];
    periodTimes.push(await timed(() => next.click()));
    urls.push(location.search);
  }
  const districtTimes = await cycle(byId("f-district"), ${STEPS_PER_INTERACTION});
  return { first_interaction: first, fuel_change: fuelTimes, period_change: periodTimes,
    district_change: districtTimes, period_urls: urls };
})()`;

const READY_HOOK = `
  window.__ready = new Promise((resolve) => {
    const timer = setInterval(() => {
      const fuel = document.getElementById("f-fuel");
      if (fuel && fuel.options.length > 1 && document.querySelector("[data-range-segmented] input")) {
        clearInterval(timer);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
      }
    }, 5);
  });`;

async function measure(version, browser) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => browser.send(method, params, sessionId);
  try {
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Network.setCacheDisabled", { cacheDisabled: true });
    await call("Emulation.setCPUThrottlingRate", { rate: Number(cpu) });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: READY_HOOK });
    await call("Page.navigate", { url: VERSIONS[version] });
    const load = await call("Runtime.evaluate", { expression: "window.__ready", awaitPromise: true, returnByValue: true });
    const flow = await call("Runtime.evaluate", { expression: INTERACTIONS, awaitPromise: true, returnByValue: true });
    if (flow.exceptionDetails) throw new Error(JSON.stringify(flow.exceptionDetails).slice(0, 300));
    const { period_urls: urls, ...times } = flow.result.value;
    // A period click that does not change the URL did not re-render: the timing would be meaningless.
    if (urls.some((url, i) => i > 0 && url === urls[i - 1])) {
      throw new Error(`a period click did not change the state: ${urls}`);
    }
    return { load: load.result.value, ...times };
  } finally {
    await browser.send("Target.closeTarget", { targetId });
  }
}

function summarise(runs) {
  const pick = (key) => runs.flatMap((r) => (Array.isArray(r[key]) ? r[key] : [r[key]]));
  const metrics = ["load", "first_interaction", "fuel_change", "period_change", "district_change"];
  return Object.fromEntries(metrics.map((name) => {
    const values = pick(name);
    const [min, max] = range(values);
    return [name, { median_ms: Math.round(median(values)), min_ms: Math.round(min), max_ms: Math.round(max) }];
  }));
}

const profile = mkdtempSync(join(tmpdir(), "fuelperf-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,900", "about:blank"],
{ stdio: "ignore" });
try {
  const info = await waitForBrowser();
  const browser = connect(info.webSocketDebuggerUrl);
  await browser.opened;
  const runs = { before: [], after: [] };
  await measure("before", browser); // warm-up, discarded
  for (let i = 0; i < Number(reps); i++) {
    for (const version of i % 2 ? ["after", "before"] : ["before", "after"]) runs[version].push(await measure(version, browser));
  }
  const result = { cpu_throttle: Number(cpu), repetitions: Number(reps), browser: info.Browser,
    synthetic_data: true, summary: { before: summarise(runs.before), after: summarise(runs.after) }, runs };
  writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, runs: undefined }, null, 1));
  browser.close();
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile */ }
}
