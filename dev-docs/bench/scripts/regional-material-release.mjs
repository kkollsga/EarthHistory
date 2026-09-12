#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const harnessPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(harnessPath), "../../..");
const releaseTemporaryRoot = "/tmp/earthhistory-release-0.1.4";
const defaultOutputDirectory = resolve(releaseTemporaryRoot, "benchmark");
const defaultResultPath = resolve(root, "dev-docs/bench/results/regional-material-release.json");
const controlCommit = "6af9bd9ca7836adb58eb658d37b2f7743b9de68c";
const controlAssetRoot = "public/data/reconstruction/cao-v2.4";
const controlManifestSha256 = "fa376df0e742a6cfe45937647d6bd1b9fabc6adad564e7fb41ca5456b4a64073";

function parseArguments(argv) {
  const options = {
    baseUrl: "http://127.0.0.1:4182",
    outputDirectory: defaultOutputDirectory,
    resultPath: defaultResultPath,
    limitsPath: null,
    maximumOutputMb: 64,
    selfTest: false,
    preflight: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") options.selfTest = true;
    else if (argument === "--preflight") options.preflight = true;
    else if (argument === "--base-url") options.baseUrl = argv[++index];
    else if (argument === "--output-dir") options.outputDirectory = resolve(root, argv[++index]);
    else if (argument === "--result") options.resultPath = resolve(root, argv[++index]);
    else if (argument === "--limits") options.limitsPath = resolve(root, argv[++index]);
    else if (argument === "--max-output-mb") options.maximumOutputMb = Number(argv[++index]);
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function requireOwnedPath(path, owner, label) {
  const child = resolve(path);
  const parent = `${resolve(owner)}${sep}`;
  if (!child.startsWith(parent)) throw new Error(`${label} must remain below ${owner}`);
  return child;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function treeBytes(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    bytes += entry.isDirectory() ? await treeBytes(child) : (await stat(child)).size;
  }
  return bytes;
}

function median(values) {
  if (!values.length) throw new Error("cannot take the median of an empty sequence");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) / 2)];
}

function evaluateStops(rows, scrubRows, captures, limits) {
  const group = (label, requested = "auto") => rows.filter(
    (row) => row.label === label && row.requested === requested,
  );
  const baseline411 = group("baseline411");
  const candidate411 = group("candidate411");
  const baseline410 = group("native410");
  const candidate410 = group("candidate410");
  const webgl2 = group("candidate411", "webgl2");
  const domainSmoke = rows.filter((row) => row.kind === "domain-smoke");
  const summary = {
    baseline411ReadyMedianMs: median(baseline411.map((row) => row.readyMs)),
    candidate411ReadyMedianMs: median(candidate411.map((row) => row.readyMs)),
    baseline411FrameP50MedianMs: median(baseline411.map((row) => row.frameTimeMs.p50)),
    candidate411FrameP50MedianMs: median(candidate411.map((row) => row.frameTimeMs.p50)),
    baseline410ReadyMs: baseline410[0]?.readyMs,
    candidate410ReadyMs: candidate410[0]?.readyMs,
    candidate411MaximumSpatialVertices: Math.max(
      ...candidate411.map((row) => row.staticCounts.vertices),
    ),
    candidate411MaximumSpatialTriangles: Math.max(
      ...candidate411.map((row) => row.staticCounts.triangles),
    ),
    candidate411MaximumAggregateVertices: Math.max(...candidate411.map(
      (row) => row.staticCounts.vertices + row.staticCounts.countryLineVertices,
    )),
    candidate411MaximumAggregatePrimitives: Math.max(...candidate411.map(
      (row) => row.staticCounts.triangles + row.staticCounts.countryLineSegments,
    )),
    candidate411MaximumDrawnPrimitives: Math.max(...candidate411.map(
      (row) => row.staticCounts.triangles + 2 * row.staticCounts.countryLineSegments,
    )),
    baseline411ActiveSourceBytes: median(baseline411.map((row) => row.staticCounts.activeSourceBytes)),
    candidate411ActiveSourceBytes: median(candidate411.map((row) => row.staticCounts.activeSourceBytes)),
  };
  summary.readyDeltaMs = Number(
    (summary.candidate411ReadyMedianMs - summary.baseline411ReadyMedianMs).toFixed(1),
  );
  summary.readyRatio = Number(
    (summary.candidate411ReadyMedianMs / summary.baseline411ReadyMedianMs).toFixed(4),
  );
  summary.frameRatio = Number(
    (summary.candidate411FrameP50MedianMs / summary.baseline411FrameP50MedianMs).toFixed(4),
  );
  summary.candidateAdditionalActiveSourceBytes =
    summary.candidate411ActiveSourceBytes - summary.baseline411ActiveSourceBytes;
  summary.relativeColdStopPass = summary.readyDeltaMs <= Math.max(
    limits.maximumColdReadyDeltaMs,
    summary.baseline411ReadyMedianMs * limits.maximumColdReadyRatioIncrease,
  );
  summary.relativeCadencePass = summary.frameRatio <= 1 / limits.minimumRelativeCadence;
  summary.absoluteCadencePass = summary.candidate411FrameP50MedianMs <= limits.maximumFrameP50Ms;
  summary.spatialGeometryStopPass = summary.candidate411MaximumSpatialVertices
      <= limits.maximumSpatialVertices
    && summary.candidate411MaximumSpatialTriangles <= limits.maximumSpatialTriangles;
  summary.aggregateGeometryStopPass = summary.candidate411MaximumAggregateVertices
      <= limits.maximumAggregateVertices
    && summary.candidate411MaximumAggregatePrimitives <= limits.maximumAggregatePrimitives;
  summary.forcedWebgl2Pass = webgl2.length === 2
    && webgl2.every((row) => row.actualBackend === "webgl2");
  summary.autoBackendMatchPass = baseline411.length === 5 && candidate411.length === 5
    && new Set([...baseline411, ...candidate411].map((row) => row.actualBackend)).size === 1;
  summary.correctionActivationPass = baseline411.every((row) => row.qualifiedCharts === 0
      && row.uncertainCharts === 0 && row.formationUncertainCharts === 0
      && row.modelInferredPoseCharts === 0 && row.overriddenNativeCharts === 0)
    && candidate411.every((row) => row.qualifiedCharts > 0)
    && candidate410.every((row) => row.overriddenNativeCharts === 2);
  summary.nativeAnchorPass = [0, 410, 411].every((ageMa) => rows.some(
    (row) => row.kind === "native-anchor" && row.ageMa === ageMa
      && row.nativeDataControl && row.foundationStatus === "ready",
  ));
  summary.domainSmokePass = [540, 1000, 1800].every((ageMa) => domainSmoke.some(
    (row) => row.ageMa === ageMa && row.foundationStatus === "ready"
      && Math.abs(row.requestedAgeMa - ageMa) <= 1e-6,
  ));
  summary.olderDomainCorrectionInactivePass = [1000, 1800].every((ageMa) => domainSmoke.some(
    (row) => row.ageMa === ageMa && row.support === "native-cao-foundation"
      && row.qualifiedCharts === 0 && row.uncertainCharts === 0
      && row.formationUncertainCharts === 0 && row.modelInferredPoseCharts === 0
      && row.overriddenNativeCharts === 0,
  ));
  summary.scrubStops = scrubRows.map((candidate) => {
    const baseline = scrubRows.find((row) => row.sceneId === candidate.sceneId
      && row.requested === candidate.requested && row.variant === "baseline");
    if (candidate.variant !== "candidate" || !baseline) return null;
    const frameRatio = Number((candidate.frameTimeMs.p50 / baseline.frameTimeMs.p50).toFixed(4));
    return {
      sceneId: candidate.sceneId,
      requested: candidate.requested,
      baselineFrameP50Ms: baseline.frameTimeMs.p50,
      candidateFrameP50Ms: candidate.frameTimeMs.p50,
      frameRatio,
      relativeCadencePass: frameRatio <= 1 / limits.minimumRelativeCadence,
      absoluteCadencePass: candidate.frameTimeMs.p50 <= limits.maximumFrameP50Ms,
      candidateGeometryIdentityReusePass: candidate.geometryIdentities.length === 1
        && candidate.geometryIdentities.every((identity) => typeof identity === "string" && identity.length > 0)
        && candidate.geometryLedgers.length === 1 && candidate.sameDocument,
      expectedGeometryPass: candidate.geometryLedgers.every((ledger) =>
        ledger.batches === limits.expectedSpatialBatches
        && ledger.countryLineBatches === limits.expectedCountryBatches
        && ledger.vertices === limits.expectedSpatialVertices
        && ledger.triangles === limits.expectedSpatialTriangles
        && ledger.countryLineVertices === limits.expectedCountryVertices
        && ledger.countryLineSegments === limits.expectedCountrySegments
        && ledger.drawCount === limits.expectedBaseDrawPasses),
      backendMatchPass: candidate.actualBackend === baseline.actualBackend
        && (candidate.requested !== "webgl2" || candidate.actualBackend === "webgl2"),
      evaluatedEveryAgePass: candidate.observedAges.length === candidate.requestedAges.length
        && candidate.observedAges.every((age, index) =>
          Math.abs(age - candidate.requestedAges[index]) <= 1e-6),
      errorFree: candidate.errors.length === 0 && baseline.errors.length === 0,
    };
  }).filter(Boolean);
  summary.continuousScrubPass = summary.scrubStops.length === 3
    && summary.scrubStops.every((stop) => Object.entries(stop)
      .filter(([key]) => key.endsWith("Pass") || key === "errorFree")
      .every(([, value]) => value === true));
  summary.captureCount = captures.length;
  summary.captureErrors = captures.reduce((count, capture) => count
    + capture.baseline.errorCount + capture.candidate.errorCount, 0);
  summary.allStopsPass = summary.relativeColdStopPass && summary.relativeCadencePass
    && summary.absoluteCadencePass && summary.spatialGeometryStopPass
    && summary.aggregateGeometryStopPass && summary.forcedWebgl2Pass
    && summary.autoBackendMatchPass && summary.correctionActivationPass
    && summary.nativeAnchorPass && summary.domainSmokePass
    && summary.olderDomainCorrectionInactivePass && summary.continuousScrubPass
    && summary.captureCount === 9 && summary.captureErrors === 0;
  return summary;
}

function selfTest() {
  const limits = {
    maximumColdReadyDeltaMs: 250,
    maximumColdReadyRatioIncrease: 0.2,
    minimumRelativeCadence: 0.9,
    maximumFrameP50Ms: 33.33,
    maximumSpatialVertices: 10,
    maximumSpatialTriangles: 10,
    maximumAggregateVertices: 10,
    maximumAggregatePrimitives: 10,
    expectedSpatialBatches: 1,
    expectedCountryBatches: 1,
    expectedSpatialVertices: 11,
    expectedSpatialTriangles: 11,
    expectedCountryVertices: 1,
    expectedCountrySegments: 1,
    expectedBaseDrawPasses: 1,
  };
  const staticCounts = { batches: 1, vertices: 11, triangles: 11, drawCount: 1,
    countryLineBatches: 1, countryLineVertices: 1, countryLineSegments: 1 };
  const row = (label, ageMa, kind, nativeDataControl = false, requested = "auto") => {
    const candidate = label.startsWith("candidate");
    const correctionActive = candidate && ageMa <= 540;
    return {
      label, ageMa, kind, nativeDataControl, requested, readyMs: 100,
      actualBackend: requested === "webgl2" ? "webgl2" : "webgpu",
      foundationStatus: "ready", requestedAgeMa: ageMa,
      support: ageMa > 540 ? "native-cao-foundation" : "cao-plus-qualified-material",
      qualifiedCharts: correctionActive ? 1 : 0,
      uncertainCharts: 0, formationUncertainCharts: 0, modelInferredPoseCharts: 0,
      overriddenNativeCharts: label === "candidate410" ? 2 : 0,
      frameTimeMs: { p50: 16.7 },
      staticCounts: { ...staticCounts, activeSourceBytes: candidate ? 110 : 100 },
    };
  };
  const rows = [
    ...Array.from({ length: 5 }, () => row("baseline411", 411, "comparison", true)),
    ...Array.from({ length: 5 }, () => row("candidate411", 411, "comparison")),
    row("native0", 0, "native-anchor", true),
    row("native410", 410, "native-anchor", true),
    row("native411", 411, "native-anchor", true),
    row("candidate410", 410, "candidate-anchor"),
    row("candidate411", 411, "comparison", false, "webgl2"),
    row("candidate411", 411, "comparison", false, "webgl2"),
    row("candidate540", 540, "domain-smoke"),
    row("candidate1000", 1000, "domain-smoke"),
    row("candidate1800", 1800, "domain-smoke"),
  ];
  const captures = Array.from({ length: 9 }, (_, index) => ({
    id: `fixture-${index}`, baseline: { errorCount: 0 }, candidate: { errorCount: 0 },
  }));
  const scrubRow = (sceneId, variant, requested = "auto") => ({
    sceneId, variant, requested, frameTimeMs: { p50: 16.7 }, errors: [],
    actualBackend: requested === "webgl2" ? "webgl2" : "webgpu",
    geometryIdentities: ["stable"], geometryLedgers: [staticCounts], sameDocument: true,
    requestedAges: [1], observedAges: [1],
  });
  const scrubRows = [scrubRow("seam-409-411", "baseline"),
    scrubRow("seam-409-411", "candidate"), scrubRow("modern-0-1", "baseline"),
    scrubRow("modern-0-1", "candidate"), scrubRow("seam-409-411", "baseline", "webgl2"),
    scrubRow("seam-409-411", "candidate", "webgl2")];
  const summary = evaluateStops(rows, scrubRows, captures, limits);
  const healthy = evaluateStops(rows, scrubRows, captures, {
    ...limits,
    maximumSpatialVertices: 12,
    maximumSpatialTriangles: 12,
    maximumAggregateVertices: 12,
    maximumAggregatePrimitives: 12,
  });
  if (!healthy.allStopsPass) {
    throw new Error(`self-test failed: healthy fixture was rejected: ${JSON.stringify(healthy)}`);
  }
  if (summary.allStopsPass || summary.spatialGeometryStopPass || summary.aggregateGeometryStopPass) {
    throw new Error("self-test failed: deliberately undersized geometry limits were accepted");
  }
  let escaped = false;
  try {
    requireOwnedPath(resolve(releaseTemporaryRoot, "../escape"),
      releaseTemporaryRoot, "self-test output");
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error("self-test failed: output ownership escape was accepted");
  console.log("regional-material-release: mutation self-test passed");
}

function canvasValues() {
  const canvas = document.querySelector("canvas[aria-label='Interactive three-dimensional Earth']");
  const diagnostics = window.__earthHistoryDiagnostics;
  const number = (name) => Number(canvas?.dataset[name]);
  return {
    actualBackend: canvas?.dataset.rendererBackend,
    foundationStatus: canvas?.dataset.caoFoundationStatus,
    foundationIdentity: canvas?.dataset.caoFoundationIdentity,
    foundationGeometryIdentity: canvas?.dataset.caoFoundationGeometryIdentity,
    requestedAgeMa: number("caoFoundationRequestedAgeMa"),
    support: canvas?.dataset.caoFoundationGeographySupport,
    correctionIdentity: canvas?.dataset.caoMaterialCorrectionIdentity,
    qualifiedCharts: number("caoQualifiedMaterialCharts"),
    uncertainCharts: number("caoUncertainMaterialCharts"),
    formationUncertainCharts: number("caoFormationUncertainMaterialCharts"),
    modelInferredPoseCharts: number("caoModelInferredPoseCharts"),
    overriddenNativeCharts: number("caoOverriddenNativeCharts"),
    staticCounts: {
      batches: number("caoFoundationBatches"),
      vertices: number("caoFoundationVertices"),
      triangles: number("caoFoundationTriangles"),
      drawCount: number("caoFoundationDrawCount"),
      retainedStaticBytes: number("caoFoundationStaticBytes"),
      activeSourceBytes: number("caoFoundationSourceBytes"),
      retainedPublicationBytes: number("caoFoundationPublicationBytes"),
      paletteEntries: number("caoFoundationPaletteEntries"),
      countryLineBatches: number("caoFoundationCountryLineBatches"),
      countryLineVertices: number("caoFoundationCountryLineVertices"),
      countryLineSegments: number("caoFoundationCountryLineSegments"),
      nativeBoundarySegments: number("caoFoundationNativeBoundarySegments"),
    },
    camera: {
      longitude: number("cameraLongitude"),
      latitude: number("cameraLatitude"),
      distance: diagnostics?.cameraDistance,
    },
    frameTimeMs: diagnostics?.frameTimeMs,
    effectiveQuality: diagnostics?.effectiveQuality,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  if (!options.limitsPath) throw new Error("--limits is required so stop rules exist before measurement");
  if (!Number.isFinite(options.maximumOutputMb) || options.maximumOutputMb <= 0
      || options.maximumOutputMb > 256) {
    throw new Error("--max-output-mb must be within the release owner's 256 MiB bound");
  }
  const outputDirectory = requireOwnedPath(options.outputDirectory,
    releaseTemporaryRoot, "output directory");
  const resultPath = requireOwnedPath(options.resultPath,
    resolve(root, "dev-docs/bench/results"), "result path");
  const limits = JSON.parse(await readFile(options.limitsPath, "utf8"));
  const maximumOutputBytes = options.maximumOutputMb * 1024 * 1024;
  const requiredLimits = ["maximumColdReadyDeltaMs", "maximumColdReadyRatioIncrease",
    "minimumRelativeCadence", "maximumFrameP50Ms", "maximumSpatialVertices",
    "maximumSpatialTriangles", "maximumAggregateVertices", "maximumAggregatePrimitives",
    "expectedSpatialBatches", "expectedCountryBatches", "expectedSpatialVertices",
    "expectedSpatialTriangles", "expectedCountryVertices", "expectedCountrySegments",
    "expectedBaseDrawPasses"];
  if (!requiredLimits.every((key) => Number.isFinite(limits[key]) && limits[key] > 0)) {
    throw new Error("limits file lacks a positive finite release stop rule");
  }

  const manifestPath = resolve(root, "dist/data/reconstruction/cao-v2.4/manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (!manifest.materialCorrections) throw new Error("production artifact has no correction catalog");
  if (manifest.ageDomainMa?.youngest !== 0 || manifest.ageDomainMa?.oldest !== 1800) {
    throw new Error("production artifact does not expose the expected 0-1800 Ma domain");
  }
  const assetsDirectory = resolve(root, "dist/assets");
  const entryName = (await readdir(assetsDirectory)).find((name) => /^index-.*\.js$/.test(name));
  if (!entryName) throw new Error("production artifact has no hashed JavaScript entry");
  const entryPath = resolve(assetsDirectory, entryName);
  const catalogPath = resolve(dirname(manifestPath), manifest.materialCorrections.catalog.url);
  const corePath = resolve(dirname(manifestPath), manifest.core.url);
  const paletteCatalogPath = resolve(dirname(manifestPath), manifest.motionPalette.catalog.url);
  const paletteBinaryPath = resolve(dirname(manifestPath), manifest.motionPalette.binary.url);
  const indexBytes = await readFile(resolve(root, "dist/index.html"));
  const entryBytes = await readFile(entryPath);
  const catalogBytes = await readFile(catalogPath);
  const coreBytes = await readFile(corePath);
  const paletteCatalogBytes = await readFile(paletteCatalogPath);
  const paletteBinaryBytes = await readFile(paletteBinaryPath);
  for (const [label, bytes, asset] of [["candidate core", coreBytes, manifest.core],
    ["candidate palette catalog", paletteCatalogBytes, manifest.motionPalette.catalog],
    ["candidate palette binary", paletteBinaryBytes, manifest.motionPalette.binary],
    ["candidate correction catalog", catalogBytes, manifest.materialCorrections.catalog]]) {
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new Error(`${label} fails its final manifest identity`);
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(dirname(resultPath), { recursive: true });
  const stagingDirectory = resolve(outputDirectory, "staging");
  const pairDirectory = resolve(outputDirectory, "pairs");
  const fixtureDirectory = resolve(outputDirectory, "fixtures", controlCommit);
  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(pairDirectory, { recursive: true, force: true });
  await rm(fixtureDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  await mkdir(pairDirectory, { recursive: true });
  await mkdir(fixtureDirectory, { recursive: true });

  const controlAssets = new Map();
  for (const name of ["manifest.json", "core.json", "motion-palette.json", "motion-palette.bin"]) {
    const bytes = execFileSync("git", ["show", `${controlCommit}:${controlAssetRoot}/${name}`],
      { cwd: root, encoding: null, maxBuffer: 64 * 1024 * 1024 });
    controlAssets.set(name, bytes);
    await writeFile(resolve(fixtureDirectory, name), bytes);
  }
  const controlManifestBytes = controlAssets.get("manifest.json");
  if (sha256(controlManifestBytes) !== controlManifestSha256) {
    throw new Error("pinned native-data control manifest identity changed");
  }
  const controlManifest = JSON.parse(controlManifestBytes);
  if (controlManifest.materialCorrections
      || controlManifest.ageDomainMa?.youngest !== 0 || controlManifest.ageDomainMa?.oldest !== 1800) {
    throw new Error("pinned native-data control has the wrong scope");
  }
  for (const [name, asset] of [["core.json", controlManifest.core],
    ["motion-palette.json", controlManifest.motionPalette.catalog],
    ["motion-palette.bin", controlManifest.motionPalette.binary]]) {
    const bytes = controlAssets.get(name);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new Error(`pinned native-data control ${name} fails its manifest identity`);
    }
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows"],
  });
  try {
    const browserVersion = browser.version();
    const cdp = await browser.newBrowserCDPSession();
    const systemInfo = await cdp.send("SystemInfo.getInfo");
    const rows = [];
    const scrubRows = [];
    const captures = [];
    const counts = new Map();

    async function configureNativeControlRoutes(context, nativeDataControl) {
      if (!nativeDataControl) return;
      for (const [name, bytes] of controlAssets) {
        await context.route(`**/data/reconstruction/cao-v2.4/${name}*`, (route) => route.fulfill({
          status: 200,
          contentType: name.endsWith(".json") ? "application/json" : "application/octet-stream",
          body: bytes,
        }));
      }
    }

    async function driveExactAge(page, ageMa) {
      const rawSliderValue = await page.evaluate((age) => {
        const input = document.querySelector("#geological-age");
        if (!(input instanceof HTMLInputElement)) throw new Error("geological age range is missing");
        const raw = age / 538.8 * 1000;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) throw new Error("range value setter is unavailable");
        setter.call(input, String(raw));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return Number(input.value);
      }, ageMa);
      if (Math.abs(rawSliderValue - ageMa / 538.8 * 1000) > 1e-6) {
        throw new Error(`range rounded ${ageMa} Ma to raw position ${rawSliderValue}`);
      }
      await page.waitForFunction((age) => {
        const data = document.querySelector("canvas")?.dataset;
        return data?.caoFoundationStatus === "ready"
          && Math.abs(Number(data.caoFoundationRequestedAgeMa) - age) <= 1e-6;
      }, ageMa, { timeout: 10_000 });
    }

    async function probeExactRangeInput(nativeDataControl) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      await configureNativeControlRoutes(context, nativeDataControl);
      const page = await context.newPage();
      try {
        await page.goto(`${options.baseUrl}/#age=410&layers=borders,guides&relief=8`,
          { waitUntil: "domcontentloaded" });
        await page.locator("canvas[aria-label='Interactive three-dimensional Earth']")
          .waitFor({ state: "visible", timeout: 30_000 });
        await page.locator("#timeline-scale").selectOption("phanerozoic");
        const documentIdentity = await page.evaluate(() => {
          window.__earthHistoryBenchmarkDocumentIdentity = crypto.randomUUID();
          return window.__earthHistoryBenchmarkDocumentIdentity;
        });
        await driveExactAge(page, 410.001);
        const sameDocument = await page.evaluate((identity) =>
          window.__earthHistoryBenchmarkDocumentIdentity === identity, documentIdentity);
        if (!sameDocument) throw new Error("410.001 Ma exact range probe reloaded the page");
        const values = await page.evaluate(canvasValues);
        if (nativeDataControl && values.correctionIdentity) {
          throw new Error("pinned native-data control unexpectedly loaded a correction catalog");
        }
        if (!nativeDataControl && !values.correctionIdentity) {
          throw new Error("integrated candidate did not load its correction catalog");
        }
      } finally {
        await context.close();
      }
    }

    await probeExactRangeInput(true);
    await probeExactRangeInput(false);
    if (options.preflight) {
      console.log(JSON.stringify({
        status: "benchmark preflight passed",
        candidate: {
          manifestSha256: sha256(manifestBytes), coreSha256: sha256(coreBytes),
          paletteCatalogSha256: sha256(paletteCatalogBytes),
          paletteBinarySha256: sha256(paletteBinaryBytes), catalogSha256: sha256(catalogBytes),
        },
        control: {
          commit: controlCommit, manifestSha256: sha256(controlManifestBytes),
          coreSha256: sha256(controlAssets.get("core.json")),
          paletteCatalogSha256: sha256(controlAssets.get("motion-palette.json")),
          paletteBinarySha256: sha256(controlAssets.get("motion-palette.bin")),
        },
      }, null, 2));
      return;
    }

    async function sample(label, ageMa, kind, requested = "auto", nativeDataControl = false) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      await configureNativeControlRoutes(context, nativeDataControl);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      const start = performance.now();
      const query = requested === "webgl2" ? "?renderer=webgl2" : "";
      try {
        await page.goto(`${options.baseUrl}/${query}#age=${ageMa}&layers=borders,guides&relief=8`,
          { waitUntil: "domcontentloaded" });
        const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
        await canvas.waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction((age) => {
          const data = document.querySelector("canvas")?.dataset;
          return data?.caoFoundationStatus === "ready"
            && Math.abs(Number(data.caoFoundationRequestedAgeMa) - age) <= 1e-6;
        }, ageMa, { timeout: 30_000 });
        const readyMs = performance.now() - start;
        await page.waitForFunction(() => (window.__earthHistoryDiagnostics?.frameTimeMs?.samples ?? 0) >= 120,
          undefined, { timeout: 20_000 });
        const values = await page.evaluate(canvasValues);
        const runKey = `${label}:${requested}`;
        const run = (counts.get(runKey) ?? 0) + 1;
        counts.set(runKey, run);
        rows.push({ label, ageMa, kind, requested, nativeDataControl, run,
          readyMs: Number(readyMs.toFixed(1)), ...values, errors });
        if (errors.length) throw new Error(`${label} emitted browser errors: ${errors.join(" | ")}`);
      } finally {
        await context.close();
      }
    }

    for (const labels of [["candidate411", "baseline411"], ["baseline411", "candidate411"],
      ["candidate411", "baseline411"], ["baseline411", "candidate411"],
      ["candidate411", "baseline411"]]) {
      for (const label of labels) await sample(label, 411, "comparison", "auto", label === "baseline411");
    }
    await sample("native0", 0, "native-anchor", "auto", true);
    await sample("native410", 410, "native-anchor", "auto", true);
    await sample("native411", 411, "native-anchor", "auto", true);
    await sample("candidate410", 410, "candidate-anchor");
    await sample("candidate411", 411, "comparison", "webgl2");
    await sample("candidate411", 411, "comparison", "webgl2");
    for (const ageMa of [540, 1000, 1800]) {
      await sample(`candidate${ageMa}`, ageMa, "domain-smoke");
    }

    function sweep(start, end, count, repetitions) {
      const forward = Array.from({ length: count }, (_, index) => Number(
        (start + (end - start) * index / (count - 1)).toFixed(6),
      ));
      return Array.from({ length: repetitions }, (_, index) => index % 2 === 0
        ? forward : [...forward].reverse()).flat();
    }

    async function scrub(sceneId, initialAgeMa, ages, variant, requested = "auto") {
      const nativeDataControl = variant === "baseline";
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      await configureNativeControlRoutes(context, nativeDataControl);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      try {
        const query = requested === "webgl2" ? "?renderer=webgl2" : "";
        await page.goto(`${options.baseUrl}/${query}#age=${initialAgeMa}&layers=borders,guides&relief=8&at=-91,-15`,
          { waitUntil: "domcontentloaded" });
        const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
        await canvas.waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction((age) => {
          const data = document.querySelector("canvas")?.dataset;
          return data?.caoFoundationStatus === "ready"
            && Math.abs(Number(data.caoFoundationRequestedAgeMa) - age) <= 1e-6;
        }, initialAgeMa, { timeout: 30_000 });
        await page.locator("#timeline-scale").selectOption("phanerozoic");
        const documentIdentity = await page.evaluate(() => {
          window.__earthHistoryBenchmarkDocumentIdentity ??= crypto.randomUUID();
          return window.__earthHistoryBenchmarkDocumentIdentity;
        });
        const observedAges = [];
        const foundationIdentities = new Set();
        const geometryIdentities = new Set();
        const geometryLedgers = new Set();
        const counterTransitions = [];
        let previousCounters = null;
        for (const ageMa of ages) {
          await driveExactAge(page, ageMa);
          const sameDocument = await page.evaluate((identity) =>
            window.__earthHistoryBenchmarkDocumentIdentity === identity, documentIdentity);
          if (!sameDocument) throw new Error(`${sceneId} reloaded while driving the range input`);
          const values = await page.evaluate(canvasValues);
          observedAges.push(values.requestedAgeMa);
          foundationIdentities.add(values.foundationIdentity);
          geometryIdentities.add(values.foundationGeometryIdentity);
          const geometryLedger = JSON.stringify({ batches: values.staticCounts.batches,
            countryLineBatches: values.staticCounts.countryLineBatches,
            vertices: values.staticCounts.vertices,
            triangles: values.staticCounts.triangles, drawCount: values.staticCounts.drawCount,
            countryLineVertices: values.staticCounts.countryLineVertices,
            countryLineSegments: values.staticCounts.countryLineSegments,
            uniquePrimitives: values.staticCounts.triangles + values.staticCounts.countryLineSegments,
            drawnPrimitives: values.staticCounts.triangles + 2 * values.staticCounts.countryLineSegments,
            retainedStaticBytes: values.staticCounts.retainedStaticBytes });
          geometryLedgers.add(geometryLedger);
          const counters = { support: values.support, qualifiedCharts: values.qualifiedCharts,
            uncertainCharts: values.uncertainCharts,
            formationUncertainCharts: values.formationUncertainCharts,
            modelInferredPoseCharts: values.modelInferredPoseCharts,
            overriddenNativeCharts: values.overriddenNativeCharts };
          if (JSON.stringify(counters) !== JSON.stringify(previousCounters)) {
            counterTransitions.push({ ageMa: values.requestedAgeMa, ...counters });
            previousCounters = counters;
          }
        }
        const values = await page.evaluate(canvasValues);
        if (errors.length) throw new Error(`${sceneId} ${variant} scrub: ${errors.join(" | ")}`);
        scrubRows.push({ sceneId, initialAgeMa, variant, requested, nativeDataControl,
          uiMapping: "Phanerozoic linear range: raw = ageMa / 538.8 * 1000",
          requestedAges: ages, observedAges,
          publicationIdentities: [...foundationIdentities], geometryIdentities: [...geometryIdentities],
          geometryLedgers: [...geometryLedgers].map((value) => JSON.parse(value)),
          counterTransitions, actualBackend: values.actualBackend,
          frameTimeMs: values.frameTimeMs, sameDocument: true, errors });
      } finally {
        await context.close();
      }
    }

    const seamAges = sweep(409.01, 410.99, 51, 4);
    const modernAges = sweep(0.001, 1, 101, 2);
    await scrub("seam-409-411", 409.01, seamAges, "baseline");
    await scrub("seam-409-411", 409.01, seamAges, "candidate");
    await scrub("modern-0-1", 0, modernAges, "baseline");
    await scrub("modern-0-1", 0, modernAges, "candidate");
    await scrub("seam-409-411", 409.01, seamAges, "baseline", "webgl2");
    await scrub("seam-409-411", 409.01, seamAges, "candidate", "webgl2");

    const build = {
      comparisonScope: "The same final frontend renderer compares the integrated candidate data with the exact upstream native-data foundation pinned at 6af9bd9; this is not a comparison with previously deployed JavaScript.",
      manifest: relative(root, manifestPath), manifestSha256: sha256(manifestBytes),
      index: "dist/index.html", indexSha256: sha256(indexBytes),
      entry: relative(root, entryPath), entrySha256: sha256(entryBytes),
      candidateNative: {
        core: relative(root, corePath), coreBytes: coreBytes.length, coreSha256: sha256(coreBytes),
        paletteCatalog: relative(root, paletteCatalogPath), paletteCatalogBytes: paletteCatalogBytes.length,
        paletteCatalogSha256: sha256(paletteCatalogBytes),
        paletteBinary: relative(root, paletteBinaryPath), paletteBinaryBytes: paletteBinaryBytes.length,
        paletteBinarySha256: sha256(paletteBinaryBytes),
      },
      controlNative: {
        commit: controlCommit, manifestBytes: controlManifestBytes.length,
        manifestSha256: sha256(controlManifestBytes),
        coreBytes: controlAssets.get("core.json").length,
        coreSha256: sha256(controlAssets.get("core.json")),
        paletteCatalogBytes: controlAssets.get("motion-palette.json").length,
        paletteCatalogSha256: sha256(controlAssets.get("motion-palette.json")),
        paletteBinaryBytes: controlAssets.get("motion-palette.bin").length,
        paletteBinarySha256: sha256(controlAssets.get("motion-palette.bin")),
      },
      catalog: relative(root, catalogPath), catalogSha256: sha256(catalogBytes),
    };
    const machine = { platform: os.platform(), release: os.release(), architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? null, logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(), browserChannel: "chrome", browserVersion };
    const gpu = { devices: systemInfo.gpu.devices,
      glRenderer: systemInfo.gpu.auxAttributes.glRenderer,
      skiaBackendType: systemInfo.gpu.auxAttributes.skiaBackendType };
    await writeFile(resolve(outputDirectory, "timing-rows.json"), JSON.stringify({
      schemaVersion: 1, recordedAt: new Date().toISOString(), build, machine, gpu, limits,
      rows, scrubRows,
    }, null, 2) + "\n");

    const scenes = [
      { id: "western-409", region: "regionalWestern", ageMa: 409, center: [-91, -15], distance: 1.45 },
      { id: "western-411", region: "regionalWestern", ageMa: 411, center: [-91, -15], distance: 1.45 },
      { id: "canada-pearya-409", region: "CanadaPearya", ageMa: 409, center: [-60.5, 3], distance: 1.45 },
      { id: "canada-pearya-411", region: "CanadaPearya", ageMa: 411, center: [-60.5, 3], distance: 1.45 },
      { id: "barents-svalbard-409", region: "BarentsSvalbard", ageMa: 409, center: [-46, 5], distance: 1.49 },
      { id: "barents-svalbard-411", region: "BarentsSvalbard", ageMa: 411, center: [-46, 5], distance: 1.49 },
      { id: "western-modern-0", region: "regionalWesternModern", ageMa: 0, center: [-118, 48], distance: 1.45 },
      { id: "western-modern-0p001", region: "regionalWesternModern", ageMa: 0.001, center: [-118, 48], distance: 1.45 },
      { id: "older-gray-430p001", region: "olderGrayNovaya", ageMa: 430.001, center: [-63.4, 13.5], distance: 1.45 },
    ];

    async function captureVariant(scene, variant) {
      const nativeDataControl = variant === "baseline";
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      await configureNativeControlRoutes(context, nativeDataControl);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      try {
        await page.goto(`${options.baseUrl}/#age=${scene.ageMa}&layers=borders,guides&relief=8&at=${scene.center.join(",")}`,
          { waitUntil: "domcontentloaded" });
        const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");
        await canvas.waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction(({ ageMa, center }) => {
          const data = document.querySelector("canvas")?.dataset;
          const longitude = Number(data?.cameraLongitude);
          const latitude = Number(data?.cameraLatitude);
          const longitudeError = Math.abs((((longitude - center[0]) + 540) % 360) - 180);
          return data?.caoFoundationStatus === "ready"
            && Math.abs(Number(data.caoFoundationRequestedAgeMa) - ageMa) <= 1e-6
            && longitudeError <= 1 && Math.abs(latitude - center[1]) <= 1;
        }, scene, { timeout: 30_000 });
        const box = await canvas.boundingBox();
        if (!box) throw new Error(`${scene.id} ${variant} canvas has no visible bounds`);
        await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5);
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (Number(await canvas.getAttribute("data-camera-distance")) <= scene.distance) break;
          await page.mouse.wheel(0, -450);
          await page.waitForTimeout(220);
        }
        await page.waitForFunction(({ distance }) => {
          const data = document.querySelector("canvas")?.dataset;
          return data?.caoFoundationStatus === "ready" && data?.detail === "regional"
            && Number(data?.cameraDistance) <= distance;
        }, scene, { timeout: 30_000 });
        await page.waitForTimeout(500);
        const values = await page.evaluate(canvasValues);
        if (errors.length) throw new Error(`${scene.id} ${variant}: ${errors.join(" | ")}`);
        const rawPath = resolve(stagingDirectory, `${scene.id}-${variant}.jpg`);
        await canvas.screenshot({ path: rawPath, type: "jpeg", quality: 82 });
        return { rawPath, values, errorCount: errors.length };
      } finally {
        await context.close();
      }
    }

    async function composePair(scene, baseline, candidate) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 440 },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await context.newPage();
      try {
        const baselineData = (await readFile(baseline.rawPath)).toString("base64");
        const candidateData = (await readFile(candidate.rawPath)).toString("base64");
        await page.setContent(`<!doctype html><style>
          *{box-sizing:border-box}html,body{margin:0;width:1280px;height:440px;background:#03080a;color:#f3ead5;font-family:ui-monospace,monospace}
          main{display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%}figure{margin:0;display:grid;grid-template-rows:38px 1fr;border-right:1px solid #6f756d}figure:last-child{border:0}
          figcaption{padding:11px 14px 8px;background:#071014;color:#d7c69b;font-size:13px;letter-spacing:.08em}img{width:100%;height:402px;object-fit:cover}
        </style><main><figure><figcaption>BASELINE · ${scene.ageMa} Ma · ${scene.region}</figcaption><img src="data:image/jpeg;base64,${baselineData}"></figure><figure><figcaption>CANDIDATE · ${scene.ageMa} Ma · ${scene.region}</figcaption><img src="data:image/jpeg;base64,${candidateData}"></figure></main>`);
        const pairPath = resolve(pairDirectory, `${scene.id}.jpg`);
        await page.screenshot({ path: pairPath, type: "jpeg", quality: 76 });
        return pairPath;
      } finally {
        await context.close();
      }
    }

    for (const scene of scenes) {
      const baseline = await captureVariant(scene, "baseline");
      const candidate = await captureVariant(scene, "candidate");
      if (scene.id === "older-gray-430p001"
          && candidate.values.uncertainCharts + candidate.values.formationUncertainCharts <= 0) {
        throw new Error("older-gray candidate has no uncertain material charts");
      }
      const pairPath = await composePair(scene, baseline, candidate);
      captures.push({ id: scene.id, region: scene.region, ageMa: scene.ageMa,
        center: scene.center, distance: scene.distance, kind: "paired-baseline-candidate",
        imageSha256: sha256(await readFile(pairPath)),
        baseline: { errorCount: baseline.errorCount, diagnostics: baseline.values },
        candidate: { errorCount: candidate.errorCount, diagnostics: candidate.values } });
    }
    await rm(stagingDirectory, { recursive: true, force: true });
    if ((await readdir(pairDirectory)).filter((name) => name.endsWith(".jpg")).length !== 9) {
      throw new Error("bounded capture set must contain exactly nine JPEG pairs");
    }
    const outputBytes = await treeBytes(outputDirectory);
    if (outputBytes > maximumOutputBytes) {
      throw new Error(`benchmark output exceeds ${options.maximumOutputMb} MiB: ${outputBytes} bytes`);
    }

    const summary = evaluateStops(rows, scrubRows, captures, limits);
    const result = {
      schemaVersion: 4,
      recordedAt: new Date().toISOString(),
      harness: relative(root, harnessPath),
      method: "Headed installed Chrome against a production Vite preview; the same final frontend renderer serves either the integrated candidate data or exact upstream native-data manifest/core/motion-palette bytes pinned at 6af9bd9; fresh reduced-motion 1280x720 DPR1 contexts; five alternating-order native/candidate pairs at 411 Ma; native 0/410/411 anchors; candidate 410; two forced-WebGL2 candidate runs; candidate 540/1000/1800 domain smoke; continuous 409.01-410.99 and 0.001-1 Ma same-clock scrubs with a forced-WebGL2 seam pair; 120 frame samples per stationary timing run; nine same-age, same-camera visual pairs.",
      build, machine, gpu, limits, summary, rows, scrubRows, captures,
      boundedOutput: { maximumOutputBytes, measuredOutputBytes: outputBytes,
        pairCount: 9, rawCapturesRetained: 0,
        cleanupOwner: "the release run owns and removes its temporary benchmark output" },
    };
    await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ result: relative(root, resultPath), summary, build, machine, gpu }, null, 2));
    if (!summary.allStopsPass) throw new Error(`hardware release stop failed: ${JSON.stringify(summary)}`);
  } finally {
    await browser.close();
  }
}

await main();
