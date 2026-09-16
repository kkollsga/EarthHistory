#!/usr/bin/env node
/**
 * Phase 10 performance measurement for the "Palaeo-coastlines (Cao 2017)" layer.
 *
 * The stop rule is written first and lives beside the result:
 * `dev-docs/bench/results/palaeo-coastlines-performance-stop-rule.md`. This
 * runner only measures and judges against it; it never tunes.
 *
 * Method (R11): production `dist/` served at the Pages subpath, Chrome with
 * `--disable-frame-rate-limit --disable-gpu-vsync` so the frame metric cannot
 * pin at the display's vsync cap, rAF-interval sampling over 5 s after a 2.5 s
 * settle, three repetitions per arm per profile with the arms alternated, and
 * the one-minute load average read before every repetition (this machine is
 * shared with other agents; a repetition waits for the load to fall below 3.0).
 *
 * Usage: node scripts/bench/palaeo-coastlines-performance.mjs [outFile]
 *        [--transactions-only] [--only=<id prefix>[,<id prefix>...]]
 *
 * `--transactions-only` keeps the steady-state rows of the record it is writing
 * over and re-measures the transactions; `--only=` narrows that to the
 * transactions whose id starts with one of the listed prefixes, so a single
 * transaction can be re-measured without paying for the others. A transaction
 * that was not selected is reported as `notMeasured` and is excluded from the
 * verdict rather than counted as a pass.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const transactionsOnly = process.argv.includes("--transactions-only");
/**
 * Transaction ids to measure, by prefix. `null` means all of them. The M0
 * baseline of the resident-intervals program measures two transactions on a
 * build whose steady-state rows are not being re-taken, and the frame metric is
 * deliberately left unrun while other agents hold this machine busy.
 */
const runOnly = (() => {
  const flag = process.argv.find((value) => value.startsWith("--only="));
  const prefixes = flag ? flag.slice("--only=".length).split(",").filter(Boolean) : [];
  return prefixes.length > 0 ? prefixes : null;
})();
const selectedTransaction = (id) =>
  runOnly === null || runOnly.some((prefix) => id.startsWith(prefix));
const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const outFile = path.resolve(positional[0]
  ?? path.join(repoRoot, "dev-docs", "bench", "results", "palaeo-coastlines-performance.json"));
// Re-running only the transactions keeps the 48 steady-state samples that are
// already measured: they are the expensive half and nothing about them changed.
// A first run into a fresh path has nothing to keep, so a missing file is not
// an error: the steady-state half is then simply absent and the verdict says so
// rather than judging thresholds 1 and 2 against no rows.
const priorRecord = transactionsOnly && existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, "utf8")) : null;
const port = Number(process.env.EARTHHISTORY_BENCH_PORT ?? 4193);
const baseUrl = `http://127.0.0.1:${port}/EarthHistory/`;
const GLOBE = "canvas[aria-label='Interactive three-dimensional Earth']";

// Stop-rule constants, copied from the markdown written before the run.
const STOP_RULE = {
  anchors: { default: { p50Ms: 1.7, p95Ms: 2.4 }, lowQuality: { p50Ms: 1.1, p95Ms: 1.8 } },
  offRegressionMaxMs: 0.1,
  onOverOffMaxRatio: { default: 2.5, lowQuality: 3 },
  intervalCrossingMaxMs: { warm: 250, cold: 1500 },
  toggleOnMaxMs: 600,
  palaeoBytesWhenOff: 0,
  vsyncPinMs: 16.67,
  vsyncPinToleranceMs: 0.3,
  maxLoadAverage: 3,
  // Two other agents share this machine and hold the one-minute average near
  // the gate for minutes at a time, so an unbounded wait would not finish. The
  // sample proceeds after this long and records the load it actually ran at,
  // which the alternated arms then charge to both sides equally.
  loadWaitMaxMs: 180_000,
  // Resident intervals, M0. Rows 2, 5 and 6 of the stop rule written before
  // measuring in `dev-docs/plans/resident-intervals.md`: a fast four-boundary
  // scrub must not cost a long frame, and preparing every interval must not
  // cost more than the memory the user agreed to.
  fastScrubLongestFrameMaxMs: 33,
  slowFrameThresholdMs: 33,
  heapGrowthMaxBytes: 60 * 1024 * 1024,
  gpuResidentMaxBytes: 55 * 1024 * 1024,
};

/**
 * The fast scrub of stop-rule row 2: 117 -> 58 Ma in 2 s, crossing the
 * 117-94 / 94-81 / 81-58 boundaries. The age is driven from inside the page on
 * a 50 ms timer rather than one Playwright round trip per step: a driver round
 * trip costs more than the step it is trying to place, and the jitter would be
 * charged to the frame intervals this transaction exists to measure.
 */
const FAST_SCRUB = {
  fromAgeMa: 117, toAgeMa: 58, steps: 40, stepMs: 50, tailMs: 1_000,
  startIntervalId: "117-94", endIntervalId: "81-58",
};
/** Stop-rule rows 5 and 6 are read this long after the layer has settled. */
const RESIDENCY_WARMUP_MS = 15_000;

const AGES = [
  { id: "0ma", ageMa: 0, why: "outside the Cao 2017 map domain: the fallback composition" },
  { id: "90ma", ageMa: 90, why: "the 94-81 Ma interval" },
  { id: "250ma", ageMa: 250, why: "the 269-248 Ma interval" },
  { id: "21ka", ageMa: 0.021, why: "the detached LGM lowstand band" },
];
const PROFILES = [
  { id: "default", quality: "High detail", expect: "high" },
  { id: "lowQuality", quality: "Reduced detail", expect: "low" },
];
const REPETITIONS = 3;
/**
 * Transactions get a longer budget than the thresholds they are judged against.
 * A wait that expires measures nothing at all, and this machine runs two other
 * agents: a load spike must be able to make a transaction *slow* and fail its
 * threshold, never make it unmeasured.
 */
const TRANSACTION_TIMEOUT_MS = 180_000;
/**
 * The frame metric needs an uncapped browser so a p50 cannot pin at the vsync
 * cap; the transactions do not, because they are wall-clock durations and not
 * frame intervals. They are measured in a second browser without
 * `--disable-frame-rate-limit`, and that is not a convenience: with that flag
 * the 94 -> 80 Ma crossing never completes. Diagnosed 2026-09-16 against the
 * built `dist/` by launching the same driver four ways - the flag trio, the
 * trio without `reducedMotion`, the trio after a 10 s warm settle, and no
 * flags - and then one flag at a time. Every arm carrying
 * `--disable-frame-rate-limit` left the layer at `mode=loading` with an empty
 * interval id past 60 s while the age had already reached 80 Ma; without it the
 * crossing landed in 258 ms, and `--disable-gpu-vsync` and
 * `--disable-gpu-frame-rate-limit` each landed it alone (284 ms, 339 ms). Timer
 * service was measured in the stuck page and is not the cause: a 0 ms timer
 * fired in 2.9 ms and rAF still ran at ~400 Hz while the interval load sat
 * unresolved. So the uncapped flag is kept where it is needed and dropped where
 * it destroys the measurement.
 */
const FRAME_METRIC_ARGS = [
  "--disable-frame-rate-limit", "--disable-gpu-vsync", "--disable-gpu-frame-rate-limit",
];
/**
 * `--enable-precise-memory-info` makes `performance.memory.usedJSHeapSize` an
 * exact byte count instead of the bucketed value Chrome reports by default; the
 * heap threshold is 60 MB and the default buckets cannot resolve it.
 */
const TRANSACTION_ARGS = ["--disable-gpu-vsync", "--disable-gpu-frame-rate-limit",
  "--enable-precise-memory-info"];
const SETTLE_MS = 2_500;
const SAMPLE_MS = 5_000;

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor((sorted.length - 1) * fraction)].toFixed(2));
}

function machineState() {
  const [one, five, fifteen] = os.loadavg();
  let swap = null;
  try {
    swap = execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8", timeout: 5_000 }).trim();
  } catch {}
  return {
    loadAverage: { one: Number(one.toFixed(2)), five: Number(five.toFixed(2)),
      fifteen: Number(fifteen.toFixed(2)) },
    freeMemoryBytes: os.freemem(), swap, at: new Date().toISOString(),
  };
}

async function waitForQuietMachine() {
  const started = Date.now();
  let waitedMs = 0;
  for (;;) {
    const state = machineState();
    if (state.loadAverage.one < STOP_RULE.maxLoadAverage) return { ...state, waitedMs };
    waitedMs = Date.now() - started;
    if (waitedMs > STOP_RULE.loadWaitMaxMs) {
      process.stderr.write(`  load ${state.loadAverage.one} after ${Math.round(waitedMs / 1000)} s wait\n`);
      return { ...state, waitedMs, quiet: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

function hardware() {
  let summary = "unavailable";
  try {
    summary = execFileSync("system_profiler", ["SPHardwareDataType", "SPDisplaysDataType"],
      { encoding: "utf8", timeout: 15_000 })
      .split("\n")
      .filter((line) => /Model Name:|Model Identifier:|Chip:|Total Number of Cores:|Memory:|Chipset Model:|Resolution:/.test(line))
      .map((line) => line.trim()).join("; ");
  } catch {}
  return { platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), summary };
}

function startServer() {
  const child = spawn(process.execPath, [path.join(repoRoot, "tests", "browser", "server.mjs")], {
    cwd: repoRoot, env: { ...process.env, EARTHHISTORY_TEST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("listening")) resolve(child); });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    setTimeout(() => reject(new Error("test server did not start")), 15_000).unref?.();
  });
}

const hashFor = (ageMa, on, at) =>
  `#age=${ageMa}&layers=${on ? "borders,guides,palaeoCoastlines" : "borders,guides"}`
  + (at === undefined ? "" : `&at=${at}`);

async function waitForReady(page, ageMa, on) {
  await page.locator(GLOBE).waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction((age) => {
    const data = document.querySelector("canvas")?.dataset;
    return data?.caoFoundationStatus === "ready"
      && Math.abs(Number(data.caoFoundationRequestedAgeMa) - age) <= 1e-6;
  }, ageMa, { timeout: 60_000 });
  if (on) {
    // "on" inside the Cao band, "fallback" outside it: both are settled states.
    await page.waitForFunction(() => {
      const mode = document.querySelector("canvas")?.dataset.caoPalaeoCoastlineMode;
      return mode === "on" || mode === "fallback";
    }, undefined, { timeout: 60_000 });
  }
}

/** Installs a rAF interval recorder that survives until it is read. */
async function startFrameCapture(page) {
  await page.evaluate(() => {
    const store = { frames: [], last: 0, running: true };
    window.__palaeoBench = store;
    const tick = (now) => {
      if (!store.running) return;
      if (store.last > 0) store.frames.push(now - store.last);
      store.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readFrames(page) {
  return page.evaluate(() => {
    const store = window.__palaeoBench;
    store.running = false;
    return store.frames.filter((value) => value > 0 && value < 1000);
  });
}

async function setQuality(page, name, expect) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: /^Rendering quality/ }).click();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.waitForFunction((quality) => {
    const data = document.querySelector("canvas")?.dataset;
    return data?.quality === quality && data.surfaceStatus === "ready";
  }, expect, { timeout: 60_000 });
  await page.getByRole("button", { name: "Close dialog" }).click();
}

const canvasValues = () => {
  const data = document.querySelector("canvas")?.dataset ?? {};
  return {
    quality: data.quality ?? null,
    devicePixelRatio: window.devicePixelRatio,
    palaeoMode: data.caoPalaeoCoastlineMode ?? null,
    palaeoIntervalId: data.caoPalaeoIntervalId ?? null,
    palaeoAssetBytes: Number(data.caoPalaeoAssetBytes ?? 0),
    palaeoCharts: Number(data.caoPalaeoCharts ?? 0),
    palaeoTriangles: Number(data.caoPalaeoTriangles ?? 0),
    foundationTriangles: Number(data.caoFoundationTriangles ?? 0),
    foundationStaticBytes: Number(data.caoFoundationStaticBytes ?? 0),
    foundationSourceBytes: Number(data.caoFoundationSourceBytes ?? 0),
    foundationPublicationBytes: Number(data.caoFoundationPublicationBytes ?? 0),
    foundationPendingRetirementBytes: Number(data.caoFoundationPendingRetirementBytes ?? 0),
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
  };
};

/**
 * What the application is holding once every interval it means to prepare is
 * prepared: the JS heap, the GPU bytes the Cao unit reports as resident, its
 * fixed static budget, and the nearest thing this build has to an engine
 * ledger. `window.__earthHistoryLedger` does not exist in v0.1.20; the nearest
 * exposure is `window.__earthHistoryDiagnostics`, whose byte fields are copied
 * here under `engineLedgerSource` so a later build that does publish a ledger
 * can be compared against the same rows.
 */
const residencyValues = () => {
  const data = document.querySelector("canvas")?.dataset ?? {};
  const number = (value) => (value === undefined || value === "" ? null : Number(value));
  const ledger = window.__earthHistoryLedger ?? null;
  const diagnostics = window.__earthHistoryDiagnostics ?? null;
  return {
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
    foundationGpuBytes: number(data.caoFoundationGpuBytes),
    foundationStaticBytes: number(data.caoFoundationStaticBytes),
    foundationStaticGpuBytes: number(data.caoFoundationStaticGpuBytes),
    foundationStaticSourceBytes: number(data.caoFoundationStaticSourceBytes),
    foundationSourceBytes: number(data.caoFoundationSourceBytes),
    foundationPublicationBytes: number(data.caoFoundationPublicationBytes),
    foundationPendingRetirementBytes: number(data.caoFoundationPendingRetirementBytes),
    foundationReleasedClasses: data.caoFoundationReleasedClasses ?? "",
    palaeoMode: data.caoPalaeoCoastlineMode ?? null,
    palaeoIntervalId: data.caoPalaeoIntervalId ?? null,
    palaeoIntervalBytes: number(data.caoPalaeoIntervalBytes),
    palaeoToneBytes: number(data.caoPalaeoToneBytes),
    palaeoAssetBytes: number(data.caoPalaeoAssetBytes),
    palaeoTriangles: number(data.caoPalaeoTriangles),
    engineLedgerSource: ledger ? "window.__earthHistoryLedger"
      : diagnostics ? "window.__earthHistoryDiagnostics (nearest; no ledger in this build)"
      : null,
    engineLedger: ledger ?? (diagnostics === null ? null : {
      cacheBytes: diagnostics.cacheBytes ?? null,
      rendererMemory: diagnostics.rendererMemory ?? null,
      temporalStagingBytes: diagnostics.temporal?.stagingBytes ?? null,
      temporalScratchPeakBytes: diagnostics.temporal?.scratchPeakBytes ?? null,
      cubeCacheBytes: diagnostics.cube?.cacheBytes ?? null,
      cubeGeometryCopyBytes: diagnostics.cube?.geometryCopyBytes ?? null,
      cubeGpuTextureEstimateBytes: diagnostics.cube?.gpuTextureEstimateBytes ?? null,
      cubeWorkerRetainedBytes: diagnostics.cube?.workerRetainedBytes ?? null,
      cubeResidentTiles: diagnostics.cube?.residentTiles ?? null,
    }),
  };
};

async function main() {
  mkdirSync(path.dirname(outFile), { recursive: true });
  const server = await startServer();
  // Only the steady-state half needs the uncapped browser. A transactions-only
  // run leaves it unlaunched: an idle Chrome with the frame-rate limit removed
  // still runs a GPU process beside the measurement, and nothing here would use it.
  const browser = transactionsOnly ? null
    : await chromium.launch({ channel: "chrome", args: FRAME_METRIC_ARGS });
  const transactionBrowser = await chromium.launch({ channel: "chrome", args: TRANSACTION_ARGS });
  const rows = priorRecord?.rows ?? [];
  const transactions = [];
  const network = priorRecord?.network ?? [];
  const errors = [];
  /** Transaction ids `--only=` excluded: reported, and judged by nothing. */
  const notMeasured = [];
  try {
    async function sample(profile, arm, age, repetition) {
      process.stderr.write(`${new Date().toISOString()} ${profile.id}/${age.id}/${arm} rep ${repetition}\n`);
      const machine = await waitForQuietMachine();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2, reducedMotion: "reduce" });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
      });
      const fetched = [];
      page.on("response", (response) => {
        const url = response.url();
        if (url.includes("/palaeo-coastlines/")) fetched.push(url.split("/").pop());
      });
      try {
        await page.goto(`${baseUrl}${hashFor(age.ageMa, arm === "on")}`,
          { waitUntil: "domcontentloaded" });
        await waitForReady(page, age.ageMa, arm === "on");
        if (profile.id !== "default") await setQuality(page, profile.quality, profile.expect);
        await page.waitForTimeout(SETTLE_MS);
        await startFrameCapture(page);
        await page.waitForTimeout(SAMPLE_MS);
        const frames = await readFrames(page);
        const values = await page.evaluate(canvasValues);
        rows.push({
          profile: profile.id, arm, age: age.id, ageMa: age.ageMa, repetition, machine,
          p50Ms: percentile(frames, 0.5), p95Ms: percentile(frames, 0.95),
          frames: frames.length, maxMs: frames.length ? Number(Math.max(...frames).toFixed(2)) : null,
          ...values, palaeoFilesFetched: fetched.length, pageErrors,
        });
        if (arm === "off") network.push({ profile: profile.id, age: age.id, repetition, fetched });
        errors.push(...pageErrors);
      } finally {
        await context.close();
      }
    }

    if (!transactionsOnly) {
      for (const profile of PROFILES) {
        for (const age of AGES) {
          for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
            // Alternated, not blocked: drift and residual load fall on both arms.
            for (const arm of ["off", "on"]) await sample(profile, arm, age, repetition);
          }
        }
      }
    }

    // Transactions. Each is its own document so the cold case is really cold.
    async function transaction(id, run) {
      if (!selectedTransaction(id)) { notMeasured.push(id); return; }
      process.stderr.write(`${new Date().toISOString()} transaction ${id}\n`);
      const machine = await waitForQuietMachine();
      const context = await transactionBrowser.newContext({ viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2, reducedMotion: "reduce" });
      const page = await context.newPage();
      try {
        const measured = await run(page);
        transactions.push({ id, machine, ...measured });
      } catch (error) {
        // A transaction that could not be driven is recorded as a failure and
        // judged as a miss. Throwing here would discard the 48 steady-state
        // samples that are already measured, which is a worse outcome than
        // reporting the transaction unmeasured.
        transactions.push({ id, machine, failed: String(error).split("\n")[0] });
        process.stderr.write(`  transaction ${id} failed: ${String(error).split("\n")[0]}\n`);
      } finally {
        await context.close();
      }
    }

    // Every transaction is driven through the application's own controls. The
    // URL fragment is read once at load and never again, so setting it would
    // measure nothing at all: the probe that established this is recorded in
    // the result's `method.transactionDriver`.
    // Selecting the scale re-renders the range, which discards a value written
    // in the same tick: it is done once during setup, outside the measured
    // window, and the range is left to settle before the age is driven.
    const selectPhanerozoic = async (page) => {
      await page.locator("#timeline-scale").selectOption("phanerozoic");
      await page.waitForTimeout(500);
    };
    const setAge = async (page, ageMa) => {
      await page.locator("#geological-age").evaluate((element, age) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter.call(element, String(age / 538.8 * 1000));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, ageMa);
    };
    const openLayers = async (page) => {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
    };

    const crossInterval = async (page, warm) => {
      await page.goto(`${baseUrl}${hashFor(94, true)}`, { waitUntil: "domcontentloaded" });
      await waitForReady(page, 94, true);
      await page.waitForFunction(() =>
        document.querySelector("canvas")?.dataset.caoPalaeoIntervalId === "94-81",
      undefined, { timeout: 60_000 });
      await selectPhanerozoic(page);
      // Warm: let the neighbouring interval's prefetch settle first. Cold: cross
      // as soon as the first interval is on screen.
      await page.waitForTimeout(warm ? 5_000 : 0);
      const started = await page.evaluate(() => performance.now());
      await setAge(page, 80);
      await page.waitForFunction(() => {
        const data = document.querySelector("canvas")?.dataset;
        return Math.abs(Number(data?.caoFoundationRequestedAgeMa) - 80) <= 1e-6;
      }, undefined, { timeout: TRANSACTION_TIMEOUT_MS });
      await page.waitForFunction(() => {
        const data = document.querySelector("canvas")?.dataset;
        return data?.caoPalaeoIntervalId === "81-58" && Number(data.caoPalaeoTriangles) > 0;
      }, undefined, { timeout: TRANSACTION_TIMEOUT_MS });
      const elapsedMs = await page.evaluate((from) => performance.now() - from, started);
      const values = await page.evaluate(canvasValues);
      return { elapsedMs: Number(elapsedMs.toFixed(1)), ...values };
    };

    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      await transaction(`intervalCrossing94to80Warm#${repetition}`, (page) => crossInterval(page, true));
      await transaction(`intervalCrossing94to80Cold#${repetition}`, (page) => crossInterval(page, false));
    }

    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    await transaction(`toggleOn90Ma#${repetition}`, async (page) => {
      const fetched = [];
      page.on("response", (response) => {
        if (response.url().includes("/palaeo-coastlines/")) fetched.push(response.url().split("/").pop());
      });
      await page.goto(`${baseUrl}${hashFor(90, false)}`, { waitUntil: "domcontentloaded" });
      await waitForReady(page, 90, false);
      await page.waitForTimeout(3_000);
      const beforeToggle = fetched.length;
      await openLayers(page);
      const started = await page.evaluate(() => performance.now());
      // The layer's own control, by its current label. It was renamed from
      // "Palaeo-coastlines (Cao 2017)" to "Realistic coastlines" after the
      // 2026-09-15 run, and the stale name matched nothing: the click expired
      // at 30 s in both browsers, which is what left this transaction with
      // three failures and no number on 2026-09-16.
      await page.getByRole("button", { name: /^Realistic coastlines/ }).click();
      await page.waitForFunction(() => {
        const data = document.querySelector("canvas")?.dataset;
        return data?.caoPalaeoCoastlineMode === "on" && Number(data.caoPalaeoTriangles) > 0;
      }, undefined, { timeout: TRANSACTION_TIMEOUT_MS });
      const elapsedMs = await page.evaluate((from) => performance.now() - from, started);
      const values = await page.evaluate(canvasValues);
      return { elapsedMs: Number(elapsedMs.toFixed(1)),
        palaeoFilesFetchedBeforeToggle: beforeToggle,
        palaeoFilesFetchedForToggle: fetched.length - beforeToggle, ...values };
    });
    }

    /**
     * Stop-rule row 2. From a settled 117 Ma the age is driven to 58 Ma over
     * 2 s in 40 steps, crossing three map boundaries, while the page records
     * its own rAF intervals, every change of `data-cao-palaeo-interval-id`, and
     * the motion probe's per-frame palaeo pose. The pose answers the question
     * the longest frame cannot: whether the outgoing map kept being posed while
     * the incoming one was still being prepared, or froze on screen.
     */
    /**
     * Page errors during a transaction. The steady-state arms already collect
     * them; a transaction that throws in the application is measuring a broken
     * run and must say so beside its numbers, not report a fast frame because
     * the scene stopped rendering.
     */
    const collectPageErrors = (page) => {
      const collected = [];
      page.on("pageerror", (error) => collected.push(String(error).split("\n")[0]));
      page.on("console", (message) => {
        if (message.type() === "error") collected.push(message.text());
      });
      return collected;
    };

    const fastScrub = async (page) => {
      const pageErrors = collectPageErrors(page);
      await page.goto(`${baseUrl}${hashFor(FAST_SCRUB.fromAgeMa, true)}`,
        { waitUntil: "domcontentloaded" });
      await waitForReady(page, FAST_SCRUB.fromAgeMa, true);
      await page.waitForFunction((id) =>
        document.querySelector("canvas")?.dataset.caoPalaeoIntervalId === id,
      FAST_SCRUB.startIntervalId, { timeout: TRANSACTION_TIMEOUT_MS });
      await selectPhanerozoic(page);
      // Settled, and the neighbour's prefetch given the same head start the
      // warm crossing gets: this transaction measures a scrub, not a cold load.
      await page.waitForTimeout(5_000);
      const measured = await page.evaluate(async (plan) => {
        const element = document.querySelector("#geological-age");
        const canvas = document.querySelector("canvas");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        const frames = [];
        const publishes = [];
        let lastIntervalId = canvas?.dataset.caoPalaeoIntervalId ?? "";
        const startIntervalId = lastIntervalId;
        let last = 0;
        let running = true;
        const tick = (now) => {
          if (!running) return;
          if (last > 0) frames.push(now - last);
          last = now;
          const id = canvas?.dataset.caoPalaeoIntervalId ?? "";
          if (id !== lastIntervalId) {
            publishes.push({ atMs: Number(now.toFixed(1)), from: lastIntervalId, to: id });
            lastIntervalId = id;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        // The array the probe hands back on "start" is the one it appends to.
        // Holding it here is not a convenience: a scene teardown deletes
        // `window.__earthHistoryMotionProbe`, and reading the probe again at the
        // end would report zero samples for a scrub that was in fact recorded
        // right up to the moment the scene went away.
        const probeSamples = window.__earthHistoryMotionProbe?.("start") ?? [];
        const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
        const started = performance.now();
        for (let step = 1; step <= plan.steps; step += 1) {
          const age = plan.fromAgeMa
            + (plan.toAgeMa - plan.fromAgeMa) * (step / plan.steps);
          setter.call(element, String(age / 538.8 * 1000));
          element.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(plan.stepMs);
        }
        const drivenMs = performance.now() - started;
        await sleep(plan.tailMs);
        running = false;
        window.__earthHistoryMotionProbe?.("stop");
        const samples = probeSamples;
        // "Kept moving" is the palaeo pose age advancing frame to frame. A run
        // of frames sharing one age is the outgoing map standing still, and the
        // longest such run is the visible freeze whatever the frame times say.
        let posed = 0;
        let poseAgeChanges = 0;
        let longestStillFrames = 0;
        let longestStillMs = 0;
        let stillFrames = 0;
        let stillSinceMs = null;
        let previousAge = null;
        for (const sample of samples) {
          if (sample.palaeoAgeMa === null) continue;
          posed += 1;
          if (previousAge === null || sample.palaeoAgeMa !== previousAge) {
            poseAgeChanges += 1;
            stillFrames = 0;
            stillSinceMs = sample.timeMs;
          } else {
            stillFrames += 1;
            longestStillFrames = Math.max(longestStillFrames, stillFrames);
            longestStillMs = Math.max(longestStillMs, sample.timeMs - (stillSinceMs ?? sample.timeMs));
          }
          previousAge = sample.palaeoAgeMa;
        }
        const drawnIds = [...new Set(samples
          .map((sample) => sample.palaeoPublishedIntervalId)
          .filter((id) => id !== null && id !== ""))];
        const undrawnFrames = samples
          .filter((sample) => sample.palaeoPublishedIntervalId === null
            || sample.palaeoPublishedIntervalId === "").length;
        return {
          drivenMs: Number(drivenMs.toFixed(1)),
          frames: frames.length,
          longestFrameMs: frames.length ? Number(Math.max(...frames).toFixed(2)) : null,
          framesOverThresholdMs: frames.filter((value) => value > plan.slowFrameThresholdMs).length,
          frameIntervalsMs: frames.map((value) => Number(value.toFixed(2))),
          intervalPublishes: publishes.length,
          publishes, startIntervalId,
          endIntervalId: canvas?.dataset.caoPalaeoIntervalId ?? "",
          motionProbeSamples: samples.length,
          posedFrames: posed,
          poseAgeChanges,
          // The probe is the only witness to a frozen outgoing map: a scrub in
          // which every posed frame changed age never showed a still map.
          outgoingMapKeptMoving: posed > 0 && longestStillFrames <= 1,
          longestStillFrames, longestStillMs: Number(longestStillMs.toFixed(1)),
          drawnIntervalIds: drawnIds,
          framesWithNoDrawnInterval: undrawnFrames,
        };
      }, { ...FAST_SCRUB, slowFrameThresholdMs: STOP_RULE.slowFrameThresholdMs });
      const values = await page.evaluate(canvasValues);
      // The globe canvas is removed when the application tears the scene down.
      // Its absence is the difference between "the scrub was smooth" and "the
      // scrub ended the scene", and the frame intervals alone cannot tell them
      // apart.
      const globeMounted = await page.locator(GLOBE).count() > 0;
      errors.push(...pageErrors);
      return { ...measured, globeMounted, pageErrors, ...values };
    };

    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      await transaction(`fastScrub117to58#${repetition}`, fastScrub);
    }

    /**
     * Stop-rule rows 5 and 6. The layer is turned on at one age, left to settle
     * and then left alone for another 15 s so any background preparation this
     * build does has finished, and the heap, the GPU bytes and the nearest
     * engine ledger are read. 0 Ma is the baseline arm: it is outside the Cao
     * map domain, so it carries the application without any prepared interval
     * and the difference is what the intervals cost.
     */
    const residency = async (page, ageMa) => {
      const pageErrors = collectPageErrors(page);
      await page.goto(`${baseUrl}${hashFor(ageMa, true)}`, { waitUntil: "domcontentloaded" });
      await waitForReady(page, ageMa, true);
      const settledAt = await page.evaluate(() => performance.now());
      await page.waitForTimeout(RESIDENCY_WARMUP_MS);
      const values = await page.evaluate(residencyValues);
      errors.push(...pageErrors);
      return {
        ageMa,
        warmupMs: RESIDENCY_WARMUP_MS,
        settleToReadMs: Number((await page.evaluate((from) => performance.now() - from, settledAt))
          .toFixed(1)),
        preciseMemoryFlag: TRANSACTION_ARGS.includes("--enable-precise-memory-info"),
        pageErrors, ...values,
      };
    };

    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      await transaction(`residencyAfterWarmup90Ma#${repetition}`, (page) => residency(page, 90));
      await transaction(`residencyAfterWarmup0Ma#${repetition}`, (page) => residency(page, 0));
    }
  } finally {
    await browser?.close();
    await transactionBrowser.close();
    server.kill();
  }

  // ---- verdicts -------------------------------------------------------------
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length === 0 ? null
      : Number(sorted[Math.floor((sorted.length - 1) / 2)].toFixed(2));
  };
  const group = (profile, arm, age) => rows
    .filter((row) => row.profile === profile && row.arm === arm && row.age === age);
  const steadyStateMeasured = rows.length > 0;
  const summary = [];
  if (steadyStateMeasured) for (const profile of PROFILES) for (const age of AGES) {
    const off = group(profile.id, "off", age.id);
    const on = group(profile.id, "on", age.id);
    summary.push({
      profile: profile.id, age: age.id, ageMa: age.ageMa, why: age.why,
      offP50Ms: median(off.map((row) => row.p50Ms)), offP95Ms: median(off.map((row) => row.p95Ms)),
      onP50Ms: median(on.map((row) => row.p50Ms)), onP95Ms: median(on.map((row) => row.p95Ms)),
      onOverOff: Number((median(on.map((row) => row.p50Ms)) / median(off.map((row) => row.p50Ms))).toFixed(2)),
      onTriangles: median(on.map((row) => row.palaeoTriangles)),
      onAssetBytes: median(on.map((row) => row.palaeoAssetBytes)),
      offPalaeoFiles: off.reduce((total, row) => total + row.palaeoFilesFetched, 0),
    });
  }
  const capped = rows.filter((row) =>
    Math.abs(row.p50Ms - STOP_RULE.vsyncPinMs) <= STOP_RULE.vsyncPinToleranceMs);
  const offAnchorMiss = !steadyStateMeasured ? [] : PROFILES.map((profile) => {
    const anchor = STOP_RULE.anchors[profile.id === "default" ? "default" : "lowQuality"];
    const observed = median(rows.filter((row) => row.profile === profile.id && row.arm === "off")
      .map((row) => row.p50Ms));
    return { profile: profile.id, anchorP50Ms: anchor.p50Ms, observedOffP50Ms: observed,
      regressionMs: Number((observed - anchor.p50Ms).toFixed(2)),
      pass: observed - anchor.p50Ms <= STOP_RULE.offRegressionMaxMs };
  });
  const ratioMiss = summary.filter((entry) => entry.onOverOff
    > STOP_RULE.onOverOffMaxRatio[entry.profile === "default" ? "default" : "lowQuality"]);
  const transactionMedian = (prefix) => {
    const measured = transactions
      .filter((entry) => entry.id.startsWith(prefix) && entry.elapsedMs !== undefined)
      .map((entry) => entry.elapsedMs);
    return { elapsedMs: median(measured), repetitions: measured.length,
      values: measured, failures: transactions
        .filter((entry) => entry.id.startsWith(prefix) && entry.failed !== undefined).length };
  };
  const warm = transactionMedian("intervalCrossing94to80Warm");
  const cold = transactionMedian("intervalCrossing94to80Cold");
  const toggle = transactionMedian("toggleOn90Ma");
  const measuredRuns = (prefix) => transactions
    .filter((entry) => entry.id.startsWith(prefix) && entry.failed === undefined);
  const scrubRuns = measuredRuns("fastScrub117to58");
  // p50 of the longest frame over the repetitions, as the plan asks: the worst
  // frame of one repetition is a single event and a median of three is the
  // smallest statement that is not one.
  const fastScrub = {
    repetitions: scrubRuns.length,
    failures: transactions.filter((entry) => entry.id.startsWith("fastScrub117to58")
      && entry.failed !== undefined).length,
    longestFrameP50Ms: median(scrubRuns.map((entry) => entry.longestFrameMs)),
    longestFrameMs: scrubRuns.map((entry) => entry.longestFrameMs),
    framesOverThresholdMs: scrubRuns.map((entry) => entry.framesOverThresholdMs),
    intervalPublishes: scrubRuns.map((entry) => entry.intervalPublishes),
    drawnIntervalIds: scrubRuns.map((entry) => entry.drawnIntervalIds),
    outgoingMapKeptMoving: scrubRuns.map((entry) => entry.outgoingMapKeptMoving),
    globeMounted: scrubRuns.map((entry) => entry.globeMounted),
    pageErrors: scrubRuns.flatMap((entry) => entry.pageErrors ?? []),
    longestStillMs: scrubRuns.map((entry) => entry.longestStillMs),
    framesWithNoDrawnInterval: scrubRuns.map((entry) => entry.framesWithNoDrawnInterval),
  };
  const residencyAt = (prefix) => {
    const runs = measuredRuns(prefix);
    return { repetitions: runs.length,
      jsHeapBytes: median(runs.map((entry) => entry.jsHeapBytes)),
      foundationGpuBytes: median(runs.map((entry) => entry.foundationGpuBytes)),
      foundationStaticBytes: median(runs.map((entry) => entry.foundationStaticBytes)),
      palaeoIntervalId: runs[0]?.palaeoIntervalId ?? null,
      palaeoMode: runs[0]?.palaeoMode ?? null };
  };
  const residency90 = residencyAt("residencyAfterWarmup90Ma");
  const residency0 = residencyAt("residencyAfterWarmup0Ma");
  const heapGrowthBytes = residency90.jsHeapBytes === null || residency0.jsHeapBytes === null
    ? null : residency90.jsHeapBytes - residency0.jsHeapBytes;
  const offFetched = network.flatMap((entry) => entry.fetched);
  const verdict = {
    frameMetricDiscriminated: capped.length === 0,
    cappedRows: capped.length,
    offRegression: offAnchorMiss,
    onOverOffMisses: ratioMiss,
    transactionFailures: transactions.filter((entry) => entry.failed !== undefined)
      .map((entry) => ({ id: entry.id, failed: entry.failed })),
    intervalCrossingWarm: warm,
    intervalCrossingCold: cold,
    toggleOn: toggle,
    // Resident intervals, M0 (stop-rule rows 2, 5, 6).
    fastScrub117to58: fastScrub,
    residencyAfterWarmup: { at90Ma: residency90, at0Ma: residency0,
      heapGrowthBytes,
      heapGrowthMb: heapGrowthBytes === null
        ? null : Number((heapGrowthBytes / 1024 / 1024).toFixed(1)),
      gpuBytesAt90Ma: residency90.foundationGpuBytes,
      gpuMbAt90Ma: residency90.foundationGpuBytes === null
        ? null : Number((residency90.foundationGpuBytes / 1024 / 1024).toFixed(1)) },
    palaeoFilesFetchedWithLayerOff: offFetched.length,
    steadyStateMeasured,
    transactionsNotMeasured: notMeasured,
    browserErrors: errors,
  };
  /**
   * A threshold is judged only where it was measured. `--only=` exists so one
   * transaction can be re-run on its own, and a transaction that was never
   * driven must not read as a pass; it is listed under `notMeasured` instead,
   * and a run that measured nothing cannot claim `pass`.
   */
  const judged = [];
  const judge = (name, measured, pass, detail) => {
    judged.push(measured ? { name, measured: true, pass, ...detail }
      : { name, measured: false, ...detail });
    return measured;
  };
  judge("frameMetricDiscriminated", steadyStateMeasured, capped.length === 0);
  judge("offRegression", steadyStateMeasured, offAnchorMiss.every((entry) => entry.pass));
  judge("onOverOff", steadyStateMeasured, ratioMiss.length === 0);
  judge("intervalCrossingWarm", warm.repetitions > 0,
    (warm.elapsedMs ?? Infinity) <= STOP_RULE.intervalCrossingMaxMs.warm);
  judge("intervalCrossingCold", cold.repetitions > 0,
    (cold.elapsedMs ?? Infinity) <= STOP_RULE.intervalCrossingMaxMs.cold);
  judge("toggleOn", toggle.repetitions > 0,
    (toggle.elapsedMs ?? Infinity) <= STOP_RULE.toggleOnMaxMs);
  judge("fastScrubLongestFrame", fastScrub.repetitions > 0,
    (fastScrub.longestFrameP50Ms ?? Infinity) <= STOP_RULE.fastScrubLongestFrameMaxMs,
    { thresholdMs: STOP_RULE.fastScrubLongestFrameMaxMs,
      observedMs: fastScrub.longestFrameP50Ms });
  judge("heapGrowthAfterWarmup", heapGrowthBytes !== null,
    (heapGrowthBytes ?? Infinity) <= STOP_RULE.heapGrowthMaxBytes,
    { thresholdBytes: STOP_RULE.heapGrowthMaxBytes, observedBytes: heapGrowthBytes });
  judge("gpuResidentAfterWarmup", residency90.foundationGpuBytes !== null,
    (residency90.foundationGpuBytes ?? Infinity) <= STOP_RULE.gpuResidentMaxBytes,
    { thresholdBytes: STOP_RULE.gpuResidentMaxBytes,
      observedBytes: residency90.foundationGpuBytes });
  judge("transactionFailures", true, verdict.transactionFailures.length === 0);
  judge("palaeoBytesWhenOff", steadyStateMeasured,
    offFetched.length === STOP_RULE.palaeoBytesWhenOff);
  judge("browserErrors", true, errors.length === 0);
  verdict.thresholds = judged;
  verdict.thresholdsNotMeasured = judged.filter((entry) => !entry.measured)
    .map((entry) => entry.name);
  verdict.pass = judged.some((entry) => entry.measured)
    && judged.every((entry) => !entry.measured || entry.pass);

  const record = {
    measurement: "palaeo-coastlines runtime performance (plan Phase 10, D5 protocol)",
    stopRule: "dev-docs/bench/results/palaeo-coastlines-performance-stop-rule.md",
    // The fast-scrub and residency thresholds are not this file's: they were
    // written before measuring in the resident-intervals plan, and the stop
    // rule above carries them as its M0 section.
    residentIntervalsStopRule: "dev-docs/plans/resident-intervals.md (rows 2, 5, 6)",
    measuredAt: new Date().toISOString(),
    method: {
      build: "npm run build, served by tests/browser/server.mjs at the Pages subpath",
      browser: "Chrome (playwright channel) with --disable-frame-rate-limit --disable-gpu-vsync",
      transactionBrowser: "a second Chrome without --disable-frame-rate-limit"
        + " (--disable-gpu-vsync --disable-gpu-frame-rate-limit only): with the frame-rate limit"
        + " removed the 94 -> 80 Ma crossing never completes, which is why threshold 3 had no"
        + " number. Transactions are wall-clock durations, so the uncapped frame rate the frame"
        + " metric needs buys them nothing.",
      metric: `requestAnimationFrame interval, ${SAMPLE_MS} ms after a ${SETTLE_MS} ms settle`,
      viewport: "1440x900 CSS px, deviceScaleFactor 2",
      repetitions: REPETITIONS, armOrder: "alternated off/on within each age and profile",
      fastScrub: `${FAST_SCRUB.fromAgeMa} -> ${FAST_SCRUB.toAgeMa} Ma in ${FAST_SCRUB.steps}`
        + ` steps ${FAST_SCRUB.stepMs} ms apart (117-94 / 94-81 / 81-58 boundaries), rAF intervals`
        + ` recorded during the scrub and for ${FAST_SCRUB.tailMs} ms after it. The age is driven`
        + " from inside the page, not one driver round trip per step, so the step cadence and the"
        + " frame intervals are not measuring the driver.",
      residency: `the layer on, settled, then ${RESIDENCY_WARMUP_MS} ms untouched before`
        + " performance.memory.usedJSHeapSize (Chrome --enable-precise-memory-info),"
        + " data-cao-foundation-gpu-bytes and data-cao-foundation-static-bytes are read."
        + " 90 Ma is the measured arm and 0 Ma, outside the Cao map domain, the baseline."
        + " This build exposes no window.__earthHistoryLedger; window.__earthHistoryDiagnostics"
        + " is recorded in its place under engineLedgerSource.",
      loadGuard: `one-minute load average below ${STOP_RULE.maxLoadAverage} before every repetition`,
      transactionDriver: "the application's own timeline range and Layers & relief control;"
        + " the URL fragment is read once at load and a later change to it moves nothing"
        + " (probed 2026-09-15: age and layers both stayed put)."
        + " Selecting the phanerozoic scale re-renders the range and discards a value written in"
        + " the same tick, so it is done in setup with a settle, outside the measured window.",
    },
    machine: hardware(),
    transactionsRequested: runOnly,
    transactionsOnly,
    stopRuleThresholds: STOP_RULE,
    summary, rows, transactions, network, verdict,
  };
  writeFileSync(outFile, `${JSON.stringify(record, null, 1)}\n`);
  console.log(JSON.stringify({ out: outFile, pass: verdict.pass, summary, verdict }, null, 1));
  if (!verdict.pass) process.exitCode = 1;
}

await main();
