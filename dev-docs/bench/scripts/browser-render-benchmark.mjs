#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const root = process.cwd();
const baseUrl = process.env.EARTHHISTORY_BENCH_URL ?? "http://127.0.0.1:4173";
const headed = process.argv.includes("--headed");
const outputName = process.env.EARTHHISTORY_BENCH_RESULT ?? "browser-render-initial.json";
const resultsDir = path.join(root, "dev-docs/bench/results");
const capturesDir = path.join(root, "dev-docs/bench/out");
const viewport = { width: 1440, height: 900 };

// Stop rule established before this measurement: pause optional rendering work
// if reduced quality misses 30 fps on a hardware-backed renderer, if repeat
// first visual camera response exceeds 100 ms, or if the first useful cube
// refinement repeatedly takes more than 250 ms after its base surface. Orbit-
// control damping is reported separately rather than charged to synthesis.
const stopRule = {
  reducedQualityMaxP50Ms: 33.33,
  regionalMaxP95Ms: 20,
  repeatedFirstCameraResponseMaxMs: 100,
  repeatedCubeBaseToFirstRefinementMaxMs: 250,
  consequence: "Pause optional visual detail and fix the responsive baseline.",
};

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.floor((sorted.length - 1) * fraction)].toFixed(2));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function buildMetadata() {
  const indexPath = path.join(root, "dist/index.html");
  const files = await readdir(path.join(root, "dist/assets"));
  const scripts = files.filter((file) => /^index-.*\.js$/.test(file)).sort();
  const indexStat = await stat(indexPath);
  return {
    profile: "vite production build served by vite preview",
    index: { sha256: await sha256(indexPath), modifiedAt: indexStat.mtime.toISOString() },
    entryScripts: await Promise.all(
      scripts.map(async (file) => ({ file, sha256: await sha256(path.join(root, "dist/assets", file)) })),
    ),
  };
}

function hardwareMetadata() {
  let summary = "unavailable";
  try {
    summary = execFileSync("system_profiler", ["SPHardwareDataType", "SPDisplaysDataType"], {
      encoding: "utf8",
      timeout: 10_000,
    })
      .split("\n")
      .filter((line) => /Model Name:|Model Identifier:|Chip:|Total Number of Cores:|Memory:|Chipset Model:|Resolution:/.test(line))
      .map((line) => line.trim())
      .join("; ");
  } catch {}
  return {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    summary,
  };
}

async function waitForSurface(page) {
  await page.locator("canvas[aria-label='Interactive three-dimensional Earth']").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("canvas")?.dataset.surfaceStatus === "ready",
    undefined,
    { timeout: 30_000 },
  );
}

async function resetFrameCapture(page) {
  await page.evaluate(() => window.__earthHistoryBench.reset());
}

async function captureMetrics(page, settleMs = 3_500) {
  await resetFrameCapture(page);
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const frames = window.__earthHistoryBench.frames.filter((value) => value > 0 && value < 1_000);
    const canvas = document.querySelector("canvas");
    const memory = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null;
    return {
      diagnostics: window.__earthHistoryDiagnostics ?? null,
      canvas: canvas ? { ...canvas.dataset } : null,
      documentVisibility: document.visibilityState,
      documentHasFocus: document.hasFocus(),
      rafIntervals: frames,
      memory,
    };
  }).then((sample) => ({
    diagnostics: sample.diagnostics,
    canvas: sample.canvas,
    documentVisibility: sample.documentVisibility,
    documentHasFocus: sample.documentHasFocus,
    raf: {
      samples: sample.rafIntervals.length,
      p50Ms: percentile(sample.rafIntervals, 0.5),
      p95Ms: percentile(sample.rafIntervals, 0.95),
      maxMs: sample.rafIntervals.length ? Number(Math.max(...sample.rafIntervals).toFixed(2)) : null,
      above33Ms: sample.rafIntervals.filter((value) => value > 33.33).length,
      above50Ms: sample.rafIntervals.filter((value) => value > 50).length,
    },
    memory: sample.memory,
  }));
}

async function loadControl(page, label) {
  const started = performance.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const domContentLoadedMs = performance.now() - started;
  await waitForSurface(page);
  const surfaceReadyMs = performance.now() - started;
  const sample = await captureMetrics(page);
  return {
    label,
    navigationToDomContentLoadedMs: Number(domContentLoadedMs.toFixed(2)),
    navigationToSurfaceReadyMs: Number(surfaceReadyMs.toFixed(2)),
    ...sample,
  };
}

async function setQuality(page, accessibleName) {
  if (!(await page.getByRole("dialog").isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: /^Rendering quality/ }).click();
  }
  const option = page.getByRole("button", { name: new RegExp(`^${accessibleName}`) });
  const started = performance.now();
  await option.click();
  const expected = accessibleName === "Reduced detail" ? "low" : "high";
  await page.waitForFunction(
    (quality) => {
      const canvas = document.querySelector("canvas");
      return canvas?.dataset.quality === quality && canvas.dataset.surfaceStatus === "ready";
    },
    expected,
    { timeout: 30_000 },
  );
  const inputToReadyMs = Number((performance.now() - started).toFixed(2));
  await page.getByRole("button", { name: "Close dialog" }).click();
  return inputToReadyMs;
}

async function zoomToRegional(page) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no visible bounds");
  const before = await page.evaluate(() => ({
    requestedAt: Number(document.querySelector("canvas")?.dataset.surfaceRequestedAt ?? 0),
    readyAt: Number(document.querySelector("canvas")?.dataset.surfaceReadyAt ?? 0),
    cubeRequestedAt: Number(document.querySelector("canvas")?.dataset.cubeRequestedAt ?? 0),
    cubeReadyAt: Number(document.querySelector("canvas")?.dataset.cubeReadyAt ?? 0),
    cubeTargetLodRequestedAt: Number(document.querySelector("canvas")?.dataset.cubeTargetLodRequestedAt ?? 0),
    cubeTargetLodCompleteAt: Number(document.querySelector("canvas")?.dataset.cubeTargetLodCompleteAt ?? 0),
    startedAt: performance.now(),
    cameraDistance: Number(document.querySelector("canvas")?.dataset.cameraDistance ?? 0),
  }));
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.48);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(
    (distance) => Number(document.querySelector("canvas")?.dataset.cameraDistance ?? 0) !== distance,
    before.cameraDistance,
  );
  const firstCameraResponseAt = await page.evaluate(() => performance.now());
  for (let index = 1; index < 12; index++) await page.mouse.wheel(0, -300);
  await page.waitForFunction(
    () => {
      const target = document.querySelector("canvas");
      return target?.dataset.detail === "regional" &&
        target.dataset.surfaceStatus === "ready" &&
        target.dataset.cubeStatus === "ready" &&
        target.dataset.cubeRefinementStatus === "ready" &&
        target.dataset.cubeDisplayedKey?.includes(":regional:");
    },
    undefined,
    { timeout: 30_000 },
  );
  const after = await page.evaluate(() => ({
    requestedAt: Number(document.querySelector("canvas")?.dataset.surfaceRequestedAt ?? 0),
    readyAt: Number(document.querySelector("canvas")?.dataset.surfaceReadyAt ?? 0),
    cubeRequestedAt: Number(document.querySelector("canvas")?.dataset.cubeRequestedAt ?? 0),
    cubeReadyAt: Number(document.querySelector("canvas")?.dataset.cubeReadyAt ?? 0),
    cubeFirstRefinementAt: Number(document.querySelector("canvas")?.dataset.cubeFirstRefinementAt ?? 0),
    cubeTargetLodRequestedAt: Number(document.querySelector("canvas")?.dataset.cubeTargetLodRequestedAt ?? 0),
    cubeTargetLodCompleteAt: Number(document.querySelector("canvas")?.dataset.cubeTargetLodCompleteAt ?? 0),
    cubeDisplayedKey: document.querySelector("canvas")?.dataset.cubeDisplayedKey ?? null,
  }));
  if (after.requestedAt <= before.requestedAt || after.readyAt <= before.readyAt) {
    throw new Error("Regional refinement did not publish a new request/ready timing pair.");
  }
  if (after.cubeRequestedAt <= before.cubeRequestedAt || after.cubeReadyAt <= before.cubeReadyAt) {
    throw new Error("Regional cube did not publish a new base request/ready timing pair.");
  }
  if (
    after.cubeFirstRefinementAt <= after.cubeReadyAt ||
    after.cubeTargetLodRequestedAt <= before.cubeTargetLodRequestedAt ||
    after.cubeTargetLodCompleteAt < after.cubeTargetLodRequestedAt
  ) {
    throw new Error("Regional cube did not publish a complete refinement timing chain.");
  }
  const finalReadyAt = Math.max(after.readyAt, after.cubeTargetLodCompleteAt);
  return {
    inputToFirstCameraResponseMs: Number((firstCameraResponseAt - before.startedAt).toFixed(2)),
    inputToRequestMs: Number((after.requestedAt - before.startedAt).toFixed(2)),
    requestToReadyMs: Number((after.readyAt - after.requestedAt).toFixed(2)),
    cubeInputToBaseMs: Number((after.cubeReadyAt - before.startedAt).toFixed(2)),
    cubeBaseToFirstRefinementMs: Number((after.cubeFirstRefinementAt - after.cubeReadyAt).toFixed(2)),
    cubeLatestTargetToCompleteMs: Number((after.cubeTargetLodCompleteAt - after.cubeTargetLodRequestedAt).toFixed(2)),
    inputToReadyMs: Number((finalReadyAt - before.startedAt).toFixed(2)),
    cubeDisplayedKey: after.cubeDisplayedKey,
  };
}

async function adapterMetadata(page) {
  return page.evaluate(async () => {
    let webgpu = null;
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        webgpu = {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
          isFallbackAdapter: adapter.info.isFallbackAdapter ?? null,
        };
      }
    } catch {}
    const probe = document.createElement("canvas").getContext("webgl2");
    const debug = probe?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      webgpu,
      webgl2: debug
        ? {
            vendor: probe.getParameter(debug.UNMASKED_VENDOR_WEBGL),
            renderer: probe.getParameter(debug.UNMASKED_RENDERER_WEBGL),
          }
        : null,
    };
  });
}

await mkdir(resultsDir, { recursive: true });
await mkdir(capturesDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: !headed,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const state = {
    frames: [],
    previous: performance.now(),
    reset() {
      this.frames = [];
      this.previous = performance.now();
    },
  };
  window.__earthHistoryBench = state;
  const tick = (now) => {
    state.frames.push(now - state.previous);
    if (state.frames.length > 3_000) state.frames.shift();
    state.previous = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const events = [];
const localRequests = new Set();
const externalRequests = new Set();
const page = await context.newPage();
page.on("console", (message) => events.push({
  type: `console.${message.type()}`,
  text: message.text(),
  location: message.location(),
}));
page.on("pageerror", (error) => events.push({ type: "pageerror", text: error.message }));
page.on("response", (response) => {
  const url = new URL(response.url());
  (url.origin === new URL(baseUrl).origin ? localRequests : externalRequests).add(response.url());
  if (response.status() >= 400) events.push({ type: "response", status: response.status(), url: response.url() });
});
page.on("requestfailed", (request) => events.push({
  type: "requestfailed",
  url: request.url(),
  text: request.failure()?.errorText ?? "unknown",
}));

try {
  const buildBefore = await buildMetadata();
  const first = await loadControl(page, "warm-control-1");
  const second = await loadControl(page, "warm-control-2");
  await page.screenshot({ path: path.join(capturesDir, "initial-production-desktop.png"), fullPage: true });

  const lowLatencyMs = await setQuality(page, "Reduced detail");
  const reduced = await captureMetrics(page);
  const highLatencyMs = await setQuality(page, "High detail");
  const high = await captureMetrics(page);
  const regionalTiming = await zoomToRegional(page);
  const regional = await captureMetrics(page);
  await page.screenshot({ path: path.join(capturesDir, "initial-production-regional.png"), fullPage: true });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForSurface(page);
  const repeatedRegionalTiming = await zoomToRegional(page);
  const repeatedRegional = await captureMetrics(page);

  const retinaContext = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await retinaContext.addInitScript(() => {
    const state = {
      frames: [],
      previous: performance.now(),
      reset() { this.frames = []; this.previous = performance.now(); },
    };
    window.__earthHistoryBench = state;
    const tick = (now) => {
      state.frames.push(now - state.previous);
      if (state.frames.length > 3_000) state.frames.shift();
      state.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const retinaPage = await retinaContext.newPage();
  const retinaControl = await loadControl(retinaPage, "dpr2-control");
  const retinaAdapter = await adapterMetadata(retinaPage);
  await retinaPage.screenshot({ path: path.join(capturesDir, "initial-production-dpr2.png"), fullPage: true });
  await retinaContext.close();

  const options = await page.locator("#chapter-jump option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent ?? "" })),
  );
  const adapter = await adapterMetadata(page);
  const cdp = await browser.newBrowserCDPSession();
  const systemInfo = await cdp.send("SystemInfo.getInfo");
  const buildAfter = await buildMetadata();
  if (buildBefore.index.sha256 !== buildAfter.index.sha256) {
    throw new Error("Production bundle changed during benchmark; discard this incoherent run.");
  }

  const gpu = systemInfo.gpu;
  const rendererText = [
    ...gpu.devices.map((device) => device.deviceString),
    gpu.auxAttributes.glRenderer,
  ].join(" ");
  const softwareRenderer = /swiftshader|llvmpipe|software/i.test(rendererText);
  const reducedP50 = reduced.diagnostics?.frameTimeMs?.p50 ?? reduced.raf.p50Ms;
  const regionalP95 = (sample) => sample.diagnostics?.frameTimeMs?.p95 ?? sample.raf.p95Ms;
  const stopTriggered = !softwareRenderer && (
    (reducedP50 != null && reducedP50 > stopRule.reducedQualityMaxP50Ms) ||
    [regionalP95(regional), regionalP95(repeatedRegional)]
      .every((value) => value != null && value > stopRule.regionalMaxP95Ms) ||
    [regionalTiming.inputToFirstCameraResponseMs, repeatedRegionalTiming.inputToFirstCameraResponseMs]
      .every((value) => value > stopRule.repeatedFirstCameraResponseMaxMs) ||
    [regionalTiming.cubeBaseToFirstRefinementMs, repeatedRegionalTiming.cubeBaseToFirstRefinementMs]
      .every((value) => value > stopRule.repeatedCubeBaseToFirstRefinementMaxMs)
  );

  const result = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    command: `node dev-docs/bench/scripts/browser-render-benchmark.mjs${headed ? " --headed" : ""}`,
    baseUrl,
    stopRule,
    stopRuleOutcome: {
      triggered: stopTriggered,
      hardwareBacked: !softwareRenderer,
      note: headed
        ? "Headed Chrome measurement."
        : "Headless Chrome measurement; CDP identified the selected Metal device. A locked desktop prevented a headed run.",
    },
    build: buildBefore,
    hardware: hardwareMetadata(),
    machineLoad: { loadAverage: os.loadavg(), freeMemoryBytes: os.freemem() },
    browser: {
      version: browser.version(),
      mode: headed ? "headed" : "headless",
      adapter,
      cdpGpu: {
        devices: gpu.devices,
        displayType: gpu.auxAttributes.displayType,
        glImplementationParts: gpu.auxAttributes.glImplementationParts,
        glRenderer: gpu.auxAttributes.glRenderer,
        skiaBackendType: gpu.auxAttributes.skiaBackendType,
        featureStatus: gpu.featureStatus,
      },
    },
    controls: [first, second],
    interactions: {
      reducedQuality: { inputToReadyMs: lowLatencyMs, ...reduced },
      restoredHighQuality: { inputToReadyMs: highLatencyMs, ...high },
      regionalZoom: { ...regionalTiming, ...regional },
      repeatedRegionalZoom: { ...repeatedRegionalTiming, ...repeatedRegional },
    },
    retinaControl: { ...retinaControl, adapter: retinaAdapter },
    availableChapters: options,
    chapterMeasurement: options.length > 1 ? "pending harness extension" : "not applicable: only present-day controls loaded",
    network: {
      localRequestCount: localRequests.size,
      externalRuntimeRequests: [...externalRequests].sort(),
    },
    events,
    captures: [
      "dev-docs/bench/out/initial-production-desktop.png",
      "dev-docs/bench/out/initial-production-regional.png",
      "dev-docs/bench/out/initial-production-dpr2.png",
    ],
  };
  const destination = path.join(resultsDir, outputName);
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
  console.log(destination);
  console.log(JSON.stringify({ stopRuleOutcome: result.stopRuleOutcome, controls: result.controls, interactions: result.interactions, events }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
