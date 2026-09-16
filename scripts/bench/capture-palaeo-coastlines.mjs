/**
 * Visual captures for the "Palaeo-coastlines (Cao 2017)" layer.
 *
 * Serves the built `dist/` at the Pages subpath the browser suite uses
 * (`tests/browser/server.mjs`), drives chromium through a fixed list of
 * age/region/layer states, and writes one PNG per state plus a manifest
 * recording the URL, the globe's palaeo diagnostics, the painted surface
 * classes and the wait strategy that released each shot. Evidence only: it
 * asserts nothing and never regenerates a golden.
 *
 * Camera framing note: `at=` is a direction in the *rendered* frame, so at a
 * deep age it does not land on the present-day coordinate of the same name -
 * the reconstruction has moved the plate under it. The regional `at` values
 * below were tuned against the rendered frame so the feature fills the shot;
 * `10-...-present-day-coordinate-on` keeps the untuned present-day value as
 * the witness for that difference.
 *
 * Usage: node scripts/bench/capture-palaeo-coastlines.mjs [outDir]
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const outDir = path.resolve(
  process.argv[2] ?? path.join(repoRoot, "dev-docs", "temp", "palaeo-coastlines", "visual"),
);
const port = Number(process.env.EARTHHISTORY_CAPTURE_PORT ?? 4187);
const baseUrl = `http://127.0.0.1:${port}/EarthHistory/`;
const GLOBE = "canvas[aria-label='Interactive three-dimensional Earth']";
/** Diagnostics copied into the manifest for every capture. */
const DIAGNOSTIC_KEYS = [
  "caoPalaeoCoastlineMode",
  "caoPalaeoFallbackReason",
  "caoPalaeoIntervalId",
  "caoPalaeoTriangles",
  "caoPalaeoCharts",
  "caoPalaeoAssetBytes",
  "caoOutlineToneIntervalId",
  "caoOutlineToneDarkSegments",
  "caoOutlineToneLightSegments",
  "caoFoundationStatus",
  "caoFoundationRequestedAgeMa",
  "cameraLongitude",
  "cameraLatitude",
  "cameraDistance",
];
const FOUNDATION_READY_TIMEOUT_MS = 40_000;
const PALAEO_MODE_TIMEOUT_MS = 30_000;
/**
 * A capture that names its interval waits for that interval to be *published*,
 * not merely selected. The LGM lowstand state is a detached band: reaching it
 * is a cold fetch, decode and triangulation of a map no neighbour prefetch can
 * warm, so its first publication is the slowest one this harness asks for and
 * gets a budget of its own.
 */
const PALAEO_INTERVAL_TIMEOUT_MS = 90_000;
const SETTLE_MS = 1_500;
/**
 * Zoom is driven by the wheel, so the closest regional framing is expressed as
 * the camera distance to reach rather than a step count: the step size is the
 * application's and a fixed count would silently re-frame if it changed. The
 * walk stops early when the distance stops falling, which is the zoom stop.
 */
const ZOOM_WHEEL_DELTA = -240;
const ZOOM_MAX_WHEEL_STEPS = 60;
const ZOOM_DISTANCE_TOLERANCE = 0.005;

/**
 * `on` is only reachable inside the Cao 2017 map-interval domain
 * (402-2.01 Ma). Outside it the layer resolves to `fallback`, which is a
 * terminal state and a result, not a timeout.
 */
const captures = [
  { file: "01-90ma-western-interior-seaway-off.png", age: 90, at: "-68,48", palaeo: false,
    note: "90 Ma, North American interior seaway centred, palaeo-coastlines OFF" },
  { file: "01-90ma-western-interior-seaway-on.png", age: 90, at: "-68,48", palaeo: true,
    note: "90 Ma, North American interior seaway centred, palaeo-coastlines ON" },
  { file: "02-90ma-eurasia-epicontinental-sea-off.png", age: 90, at: "25,62", palaeo: false,
    note: "90 Ma, Eurasian epicontinental sea (West Siberian Sea / Turgai region), OFF" },
  { file: "02-90ma-eurasia-epicontinental-sea-on.png", age: 90, at: "25,62", palaeo: true,
    note: "90 Ma, Eurasian epicontinental sea (West Siberian Sea / Turgai region), ON" },
  { file: "03-255ma-nw-europe-zechstein-off.png", age: 255, at: "30,55", palaeo: false, zoomSteps: 10,
    note: "255 Ma NW Europe / Zechstein region, closest regional zoom, OFF" },
  { file: "03-255ma-nw-europe-zechstein-on.png", age: 255, at: "30,55", palaeo: true, zoomSteps: 10,
    note: "255 Ma NW Europe / Zechstein region, closest regional zoom, ON" },
  { file: "04-170ma-north-sea-brent-on.png", age: 170, at: "30,55", palaeo: true,
    note: "170 Ma North Sea region (Brent-age 179-166 interval), ON, same framing as 03 unzoomed" },
  { file: "05-0ma-off.png", age: 0, at: "5,25", palaeo: false, note: "0 Ma control, OFF" },
  { file: "05-0ma-on.png", age: 0, at: "5,25", palaeo: true,
    note: "0 Ma control, ON (age outside the Cao 2017 interval domain)" },
  { file: "06-500ma-off.png", age: 500, at: "-100,-10", palaeo: false,
    note: "500 Ma control over reconstructed land, OFF" },
  { file: "06-500ma-on.png", age: 500, at: "-100,-10", palaeo: true,
    note: "500 Ma, ON (age outside the Cao 2017 interval domain)" },
  { file: "07-mobile-390x844-90ma-on-map-key.png", age: 90, at: "-68,48", palaeo: true,
    viewport: { width: 390, height: 844 }, openMapKey: true,
    note: "390x844 mobile, 90 Ma ON, map key opened" },
  { file: "08-desktop-90ma-on-layers-modal.png", age: 90, at: "-68,48", palaeo: true,
    openLayers: true, note: "90 Ma ON, Layers & relief panel opened" },
  { file: "09-desktop-90ma-on-map-key.png", age: 90, at: "-68,48", palaeo: true,
    openMapKey: true, note: "90 Ma ON, map key opened" },
  { file: "10-90ma-present-day-coordinate-on.png", age: 90, at: "-100,45", palaeo: true,
    note: "90 Ma ON with at= set to the present-day Western Interior Seaway coordinate; "
      + "the reconstruction has carried the seaway off-centre" },
  { file: "11-21ka-doggerland-closest-off.png", age: 0.021, at: "3,55", palaeo: false,
    zoomToDistance: 1.15,
    note: "21 ka, southern North Sea / Doggerland, closest regional zoom, OFF "
      + "(the control for the LGM lowstand shot)" },
  { file: "11-21ka-doggerland-closest-on.png", age: 0.021, at: "3,55", palaeo: true,
    zoomToDistance: 1.15, awaitIntervalId: "lgm",
    note: "21 ka, southern North Sea / Doggerland, closest regional zoom, ON: the detached "
      + "LGM lowstand state (26.5-19.5 ka, ETOPO 2022 at -120 m eustatic), where Doggerland "
      + "is emergent land between Britain and the Netherlands" },
];

function hashFor({ age, at, palaeo }) {
  const layers = palaeo ? "borders,guides,palaeoCoastlines" : "borders,guides";
  return `#age=${age}&layers=${layers}&at=${at}`;
}

function startServer() {
  const child = spawn(process.execPath, [path.join(repoRoot, "tests", "browser", "server.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, EARTHHISTORY_TEST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error instanceof Error ? error : new Error(String(error)));
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) resolve(child);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", fail);
    child.on("exit", (code) => fail(`test server exited early with code ${code}`));
    setTimeout(() => fail("test server did not start within 15 s"), 15_000).unref?.();
  });
}

/**
 * Wheels the globe in until the camera reaches `target`, and reports what it
 * actually reached. Stops at the zoom stop rather than spending the whole step
 * budget against a distance that is no longer falling.
 */
async function zoomToCameraDistance(page, viewport, target) {
  const readDistance = async () => Number(
    await page.locator(GLOBE).getAttribute("data-camera-distance").catch(() => null));
  await page.mouse.move(viewport.width / 2, Math.round(viewport.height * 0.55));
  let distance = await readDistance();
  let steps = 0;
  let stalled = false;
  while (steps < ZOOM_MAX_WHEEL_STEPS
    && (!Number.isFinite(distance) || distance > target + ZOOM_DISTANCE_TOLERANCE)) {
    await page.mouse.wheel(0, ZOOM_WHEEL_DELTA);
    await page.waitForTimeout(150);
    steps += 1;
    const next = await readDistance();
    if (Number.isFinite(distance) && Number.isFinite(next) && next >= distance - 1e-4) {
      distance = next;
      stalled = true;
      break;
    }
    distance = next;
  }
  return {
    targetDistance: target,
    reachedDistance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
    wheelSteps: steps,
    reachedTarget: Number.isFinite(distance) && distance <= target + ZOOM_DISTANCE_TOLERANCE,
    stoppedAtZoomStop: stalled,
  };
}

/** Poll a dataset attribute until `accept` takes it, or the budget runs out. */
async function pollDataset(page, key, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page.locator(GLOBE).getAttribute(key).catch(() => null);
    if (accept(value)) return { value, timedOut: false };
    if (Date.now() > deadline) return { value, timedOut: true };
    await page.waitForTimeout(250);
  }
}

async function readDiagnostics(page) {
  return page.locator(GLOBE).evaluate((element, keys) => {
    const dataset = element instanceof HTMLElement ? element.dataset : {};
    return Object.fromEntries(keys.map((key) => [key, dataset[key] ?? null]));
  }, DIAGNOSTIC_KEYS);
}

/**
 * Pixels painted by each palaeo surface class, by the colour rule
 * `tests/browser/explorer.spec.ts` uses. `land` is the olive landmass, so it
 * is the witness for the native composition surviving a fallback age.
 */
async function paintedSurfaceClasses(page, screenshot) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("class canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();
    const buckets = { land: 0, shallow: 0, shelf: 0 };
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luminance < 25) continue;
      if (green > blue + 8 && green > red + 4) buckets.land += 1;
      else if (blue > green + 4 && green > red + 20) {
        if (luminance > 95) buckets.shallow += 1; else buckets.shelf += 1;
      }
    }
    return { ...buckets, totalPixels: pixels.length / 4 };
  }, screenshot.toString("base64"));
}

/** Mean absolute per-channel difference between two PNG buffers, 0-255. */
async function meanAbsolutePixelDifference(page, first, second) {
  return page.evaluate(async ([a, b]) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const surface = document.createElement("canvas");
      surface.width = bitmap.width;
      surface.height = bitmap.height;
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("diff canvas is unavailable");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      return { pixels, width: surface.width, height: surface.height };
    };
    const left = await decode(a);
    const right = await decode(b);
    if (left.width !== right.width || left.height !== right.height) {
      return { error: `size mismatch ${left.width}x${left.height} vs ${right.width}x${right.height}` };
    }
    let sum = 0;
    let maxChannel = 0;
    let changed = 0;
    for (let offset = 0; offset < left.pixels.length; offset += 4) {
      let pixelMax = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel]);
        sum += delta;
        if (delta > pixelMax) pixelMax = delta;
      }
      if (pixelMax > 2) changed += 1;
      if (pixelMax > maxChannel) maxChannel = pixelMax;
    }
    const pixelCount = left.pixels.length / 4;
    return {
      width: left.width,
      height: left.height,
      meanAbsoluteDifference: Number((sum / (pixelCount * 3)).toFixed(3)),
      maxChannelDifference: maxChannel,
      pixelsDifferingByMoreThan2: changed,
      fractionDiffering: Number((changed / pixelCount).toFixed(4)),
    };
  }, [first.toString("base64"), second.toString("base64")]);
}

mkdirSync(outDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch(
  process.env.EARTHHISTORY_TEST_BROWSER_CHANNEL
    ? { channel: process.env.EARTHHISTORY_TEST_BROWSER_CHANNEL }
    : {},
);
const records = [];
const canvasShots = new Map();

try {
  for (const capture of captures) {
    const viewport = capture.viewport ?? { width: 1440, height: 900 };
    const url = `${baseUrl}${hashFor(capture)}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error)}`));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
    });

    const started = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const foundation = await pollDataset(
      page, "data-cao-foundation-status", (value) => value === "ready",
      FOUNDATION_READY_TIMEOUT_MS,
    );
    const expectedMode = capture.palaeo ? "on" : "off";
    const terminal = capture.palaeo
      ? (value) => value === "on" || value === "fallback"
      : (value) => value === "off";
    const mode = await pollDataset(
      page, "data-cao-palaeo-coastline-mode", terminal, PALAEO_MODE_TIMEOUT_MS,
    );

    if (capture.zoomSteps) {
      await page.mouse.move(viewport.width / 2, Math.round(viewport.height * 0.55));
      for (let step = 0; step < capture.zoomSteps; step += 1) {
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(150);
      }
    }
    const zoom = capture.zoomToDistance === undefined
      ? null : await zoomToCameraDistance(page, viewport, capture.zoomToDistance);
    // After the zoom, not before it: the camera move is what the published
    // interval has to survive, and at the LGM the first publication is a cold
    // one that the zoom is allowed to overlap.
    const interval = capture.awaitIntervalId === undefined ? null : await pollDataset(
      page, "data-cao-palaeo-interval-id",
      (value) => value === capture.awaitIntervalId, PALAEO_INTERVAL_TIMEOUT_MS,
    );
    if (capture.openMapKey) {
      await page.locator(".surface-info summary").click();
      await page.waitForTimeout(250);
    }
    if (capture.openLayers) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("menuitem", { name: /Layers/ }).click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(SETTLE_MS);

    const diagnostics = await readDiagnostics(page);
    const file = path.join(outDir, capture.file);
    await page.screenshot({ path: file, fullPage: false });
    const canvas = await page.locator(GLOBE).screenshot();
    canvasShots.set(capture.file, canvas);
    const painted = await paintedSurfaceClasses(page, canvas);

    records.push({
      file: capture.file,
      path: file,
      note: capture.note,
      url,
      viewport,
      expectedPalaeoMode: expectedMode,
      observedPalaeoMode: mode.value,
      reachedExpectedMode: mode.value === expectedMode,
      palaeoModeTimedOut: mode.timedOut,
      foundationStatusTimedOut: foundation.timedOut,
      interactions: {
        zoomSteps: capture.zoomSteps ?? 0,
        zoom,
        openedMapKey: Boolean(capture.openMapKey),
        openedLayersPanel: Boolean(capture.openLayers),
      },
      waitStrategy: {
        foundationStatus: `poll data-cao-foundation-status === "ready" (<= ${FOUNDATION_READY_TIMEOUT_MS} ms)`,
        palaeoMode: capture.palaeo
          ? `poll data-cao-palaeo-coastline-mode in {on, fallback} (<= ${PALAEO_MODE_TIMEOUT_MS} ms)`
          : `poll data-cao-palaeo-coastline-mode === "off" (<= ${PALAEO_MODE_TIMEOUT_MS} ms)`,
        palaeoIntervalId: capture.awaitIntervalId === undefined ? null
          : `poll data-cao-palaeo-interval-id === "${capture.awaitIntervalId}" `
            + `(<= ${PALAEO_INTERVAL_TIMEOUT_MS} ms)`,
        settleMs: SETTLE_MS,
      },
      expectedPalaeoIntervalId: capture.awaitIntervalId ?? null,
      palaeoIntervalTimedOut: interval?.timedOut ?? null,
      elapsedMs: Date.now() - started,
      diagnostics,
      paintedGlobePixels: painted,
      consoleErrors,
    });
    console.log(`${capture.file}: mode=${mode.value} interval=${diagnostics.caoPalaeoIntervalId} ` +
      (zoom ? `distance=${zoom.reachedDistance} ` : "") +
      `triangles=${diagnostics.caoPalaeoTriangles} land=${painted.land} shallow=${painted.shallow}` +
      (consoleErrors.length ? ` errors=${consoleErrors.length}` : ""));
    await context.close();
  }

  // Off/on controls: at an age with no Cao 2017 interval the two must agree.
  const diffPage = await (await browser.newContext()).newPage();
  const diffPair = async (offFile, onFile) => meanAbsolutePixelDifference(
    diffPage, canvasShots.get(offFile), canvasShots.get(onFile),
  );
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/bench/capture-palaeo-coastlines.mjs",
    baseUrl,
    outDir,
    notes: [
      "Ages outside 402-2.01 Ma have no Cao 2017 map interval; the layer reports "
        + "mode=fallback there, which is a result and not a wait failure.",
      "at= is a direction in the rendered frame. At a deep age the plate model has "
        + "moved the geography under it, so a present-day coordinate does not centre "
        + "the same region; the regional at= values here were tuned on the rendered frame.",
      "paintedGlobePixels uses the colour rule in tests/browser/explorer.spec.ts over the "
        + "globe canvas only: land is the olive Cao landmass, shallow the mapped shallow sea, "
        + "shelf the dimmed blue (which also takes lit deep ocean).",
    ],
    controls: {
      zeroMaGlobeCanvas: await diffPair("05-0ma-off.png", "05-0ma-on.png"),
      fiveHundredMaGlobeCanvas: await diffPair("06-500ma-off.png", "06-500ma-on.png"),
    },
    captures: records,
  };
  const manifestPath = path.join(outDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest: ${manifestPath}`);
  console.log(`0 Ma off/on globe diff:   ${JSON.stringify(manifest.controls.zeroMaGlobeCanvas)}`);
  console.log(`500 Ma off/on globe diff: ${JSON.stringify(manifest.controls.fiveHundredMaGlobeCanvas)}`);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
