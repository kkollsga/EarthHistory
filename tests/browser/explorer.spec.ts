import { expect, test, type Page } from "@playwright/test";
import type {
  EarthHistoryPixelSurfaceProbe,
  EarthHistorySurfaceProbe,
} from "../../src/render/GlobeScene";

declare global {
  interface Window {
    /** The scene's CPU coverage path, exposed for these probes only. */
    __earthHistorySurfaceProbe?: EarthHistorySurfaceProbe;
    /** Class and lighting under one canvas pixel; the tone census reads it. */
    __earthHistoryPixelSurfaceProbe?: EarthHistoryPixelSurfaceProbe;
  }
}

const globe = (page: Page) => page.locator("canvas[aria-label='Interactive three-dimensional Earth']");

async function waitForCao(page: Page) {
  await expect(globe(page)).toBeVisible();
  await expect.poll(() => globe(page).getAttribute("data-cao-foundation-status"), {
    timeout: 20_000,
  }).toBe("ready");
  await expect(globe(page)).toHaveAttribute("data-legacy-surface-pipeline", "removed");
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menu", { name: "Explore tools" })).toBeVisible();
}

async function openSurfaceInfo(page: Page) {
  const details = page.locator(".surface-info");
  if (!await details.evaluate((element) => element.hasAttribute("open"))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function setContinuousAge(page: Page, ageMa: number) {
  await page.locator("#timeline-scale").selectOption("phanerozoic");
  const rawValue = await page.locator("#geological-age").evaluate((element, age) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("geological age range is missing");
    const raw = age / 538.8 * 1000;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("range value setter is unavailable");
    setter.call(element, String(raw));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return Number(element.value);
  }, ageMa);
  expect(rawValue).toBeCloseTo(ageMa / 538.8 * 1000, 6);
  await page.waitForFunction((age) => {
    const value = document.querySelector<HTMLCanvasElement>(
      "canvas[aria-label='Interactive three-dimensional Earth']",
    )?.dataset.caoFoundationRequestedAgeMa;
    return value !== undefined && Math.abs(Number(value) - age) <= 1e-8;
  }, ageMa, { timeout: 20_000 });
}

async function screenshotLuminanceSamples(page: Page) {
  const screenshot = await globe(page).screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("screenshot luminance canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const sample = (left: number, top: number, width: number, height: number) => {
      const pixels = context.getImageData(
        Math.round(bitmap.width * left),
        Math.round(bitmap.height * top),
        Math.round(bitmap.width * width),
        Math.round(bitmap.height * height),
      ).data;
      let sum = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        sum += 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
      }
      return sum / (pixels.length / 4);
    };
    // Two eastward drags center the released 0 Ma Asia/Australia view. The first
    // patch is mainland Asia and the second is its adjacent Pacific control.
    const samples = {
      land: sample(0.334, 0.191, 0.094, 0.153),
      ocean: sample(0.625, 0.222, 0.113, 0.184),
    };
    bitmap.close();
    return samples;
  }, screenshot.toString("base64"));
}

/** Mean luminance of the whole globe canvas; the control the toggle must return to. */
async function globeLuminance(page: Page) {
  const screenshot = await globe(page).screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("screenshot luminance canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      sum += 0.2126 * pixels[offset]! + 0.7152 * pixels[offset + 1]! + 0.0722 * pixels[offset + 2]!;
    }
    bitmap.close();
    return sum / (pixels.length / 4);
  }, screenshot.toString("base64"));
}

/**
 * Pixels painted by each palaeo surface class, by colour signature.
 *
 * The three base colours are far enough apart to separate on the lit globe: a
 * Cao 2017 landmass is the olive `#9aa86b` (green channel highest), a mapped
 * shallow sea the teal `#14606b` and the "depth unmapped" shelf the dimmed blue
 * the native stack has always drawn, both with blue highest and the shallow sea
 * the brighter of the two. Anything else - sky, clouds, outlines, the unlit
 * limb - falls in no bucket.
 */
async function paintedSurfaceClasses(page: Page, image?: string) {
  const screenshot = image ?? await globeCanvasImage(page);
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("screenshot class canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const buckets = { land: { pixels: 0, sum: 0 }, shallow: { pixels: 0, sum: 0 },
      shelf: { pixels: 0, sum: 0 } };
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset]!;
      const green = pixels[offset + 1]!;
      const blue = pixels[offset + 2]!;
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (luminance < 25) continue;
      const bucket = green > blue + 8 && green > red + 4 ? buckets.land
        : blue > green + 4 && green > red + 20 ? (luminance > 95 ? buckets.shallow : buckets.shelf)
          : null;
      if (bucket === null) continue;
      bucket.pixels += 1;
      bucket.sum += luminance;
    }
    bitmap.close();
    return Object.fromEntries(Object.entries(buckets).map(([name, bucket]) => [name,
      { pixels: bucket.pixels, luminance: bucket.pixels === 0 ? 0 : bucket.sum / bucket.pixels }]));
  }, screenshot) as Promise<Record<"land" | "shallow" | "shelf",
    { pixels: number; luminance: number }>>;
}

/** The globe canvas as base64 PNG, so one capture answers several questions. */
async function globeCanvasImage(page: Page) {
  return (await globe(page).screenshot()).toString("base64");
}

/**
 * Channel difference between two globe-canvas captures.
 *
 * The fallback contract is an identity, not a resemblance: at an age with no
 * Cao 2017 map the layer must compose exactly what the layer-off view composes,
 * so the comparison is per channel over the whole canvas rather than a bucket
 * count that a shelf-for-land substitution can satisfy.
 */
async function globeImageDifference(page: Page, first: string, second: string) {
  return page.evaluate(async ([left, right]) => {
    const decode = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const surface = document.createElement("canvas");
      surface.width = bitmap.width;
      surface.height = bitmap.height;
      const context = surface.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("screenshot difference canvas is unavailable");
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      return image;
    };
    const before = await decode(left!);
    const after = await decode(right!);
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error("globe canvas changed size between captures");
    }
    let sum = 0;
    let differing = 0;
    let maxChannelDifference = 0;
    for (let offset = 0; offset < before.data.length; offset += 4) {
      let pixelMax = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(before.data[offset + channel]! - after.data[offset + channel]!);
        sum += difference;
        if (difference > pixelMax) pixelMax = difference;
      }
      if (pixelMax > maxChannelDifference) maxChannelDifference = pixelMax;
      if (pixelMax > 2) differing += 1;
    }
    const pixels = before.data.length / 4;
    return { meanAbsoluteDifference: sum / (pixels * 3), maxChannelDifference,
      fractionDiffering: differing / pixels };
  }, [first, second]);
}

test("loads one local Cao reconstruction and the complete chapter picker", { tag: "@ci" }, async ({ page, baseURL }) => {
  const external = new Set<string>();
  const failures: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) external.add(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("./");
  await waitForCao(page);
  const snapshot = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[aria-label='Interactive three-dimensional Earth']",
    );
    return {
      heading: document.querySelector("h1")?.textContent?.trim(),
      chapterCount: document.querySelectorAll("#chapter-jump option").length,
      geographySupport: canvas?.dataset.caoFoundationGeographySupport,
      overriddenNativeCharts: canvas?.dataset.caoOverriddenNativeCharts,
      modelInferredPoseCharts: Number(canvas?.dataset.caoModelInferredPoseCharts),
      foundationVertices: Number(canvas?.dataset.caoFoundationVertices),
    };
  });
  expect(snapshot.heading).toBe("Present day");
  expect(snapshot.chapterCount).toBe(37);
  expect(snapshot.geographySupport).toBe("cao-plus-model-pose-material");
  expect(snapshot.overriddenNativeCharts).toBe("2");
  expect(snapshot.modelInferredPoseCharts).toBeGreaterThan(0);
  expect(snapshot.foundationVertices).toBeGreaterThan(100_000);
  expect(external).toEqual(new Set());
  expect(failures).toEqual([]);
});

test("reloads fresh manifests while reusing only hash-qualified package bytes", async ({ page }) => {
  await page.goto("./#age=0");
  await waitForCao(page);
  const firstPayloadUrls = new Set(await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => url.includes("/data/reconstruction/cao-v2.4/") && new URL(url).searchParams.has("h"))));
  await page.reload();
  await waitForCao(page);
  const reloadResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => {
    const timing = entry as PerformanceResourceTiming;
    return { url: timing.name, transferSize: timing.transferSize };
  }).filter((entry) => entry.url.includes("/data/reconstruction/cao-v2.4/")));
  const manifest = reloadResources.find((entry) => entry.url.endsWith("/manifest.json"));
  const reusedPayloads = reloadResources.filter((entry) => firstPayloadUrls.has(entry.url));
  const requiredPayloads = ["core.json", "motion-palette.json", "motion-tiles/index.json",
    "motion-tiles/tile-0000-0025ma.ehmt", "batch-land.ehgb"];
  expect(manifest?.transferSize).toBeGreaterThan(0);
  for (const filename of requiredPayloads) {
    expect([...firstPayloadUrls].some((url) => new URL(url).pathname.endsWith(`/${filename}`))).toBe(true);
    expect(reusedPayloads.some((entry) => new URL(entry.url).pathname.endsWith(`/${filename}`))).toBe(true);
  }
  expect(reusedPayloads.length).toBeGreaterThan(10);
  expect(reusedPayloads.filter((entry) => entry.transferSize !== 0)
    .map((entry) => new URL(entry.url).pathname)).toEqual([]);
});

test("publishes the requested URL age before background timeline loading and keeps it on failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fullPaletteRequests = 0;
  let canvasStatusAtFirstRequest: string | null = null;
  const requestedPaths: string[] = [];
  page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));
  await page.route(/\/data\/reconstruction\/cao-v2\.4\/motion-palette\.bin\?h=/, async (route) => {
    fullPaletteRequests += 1;
    if (fullPaletteRequests === 1) {
      canvasStatusAtFirstRequest = await globe(page).getAttribute("data-cao-foundation-status");
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.goto("./#age=411");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "411");
  await expect(page.locator(".globe-stage")).toHaveAttribute("data-cao-displayed-age-ma", "411");
  expect(requestedPaths.some((path) => path.endsWith("/motion-tiles/tile-0400-0425ma.ehmt"))).toBe(true);
  expect(requestedPaths.some((path) => path.endsWith("/motion-tiles/tile-0000-0025ma.ehmt"))).toBe(false);
  await expect.poll(() => fullPaletteRequests).toBe(1);
  expect(canvasStatusAtFirstRequest).toBe("ready");
  const stage = page.locator(".globe-stage");
  await expect(stage).toHaveAttribute("data-cao-timeline-loading-status", "paused");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "ready");
  await expect(globe(page)).not.toHaveAttribute("data-cao-foundation-draw-count", "0");
  const currentIdentity = await globe(page).getAttribute("data-cao-foundation-geometry-identity");
  await openSurfaceInfo(page);
  const retry = page.getByRole("button", { name: "Retry" });
  const retryBox = await retry.boundingBox();
  expect(retryBox?.width).toBeGreaterThanOrEqual(44);
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);
  await retry.click();
  await expect.poll(() => fullPaletteRequests).toBe(2);
  await expect(stage).toHaveAttribute("data-cao-motion-tier", "full", { timeout: 20_000 });
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "ready");
  await expect(stage).toHaveAttribute("data-cao-displayed-age-ma", "411");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geometry-identity", currentIdentity!);
});

test("keeps the last rendered surface visible while a newer motion window is pending", async ({ page }) => {
  let releaseTile: (() => void) | undefined;
  let tileStarted = false;
  await page.route(/\/data\/reconstruction\/cao-v2\.4\/motion-palette\.bin\?h=/,
    (route) => route.abort("failed"));
  await page.route(/\/data\/reconstruction\/cao-v2\.4\/motion-tiles\/tile-0400-0425ma\.ehmt\?h=/,
    (route) => new Promise<void>((resolvePromise) => {
      tileStarted = true;
      releaseTile = () => { void route.continue().finally(resolvePromise); };
    }));
  await page.goto("./#age=0");
  await waitForCao(page);
  await expect(page.locator(".globe-stage")).toHaveAttribute("data-cao-timeline-loading-status", "paused");
  await page.locator("#timeline-scale").selectOption("phanerozoic");
  await page.locator("#geological-age").evaluate((element, age) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("geological age range is missing");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element,
      String(age / 538.8 * 1000));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, 411);
  const stage = page.locator(".globe-stage");
  await expect.poll(async () => Number(await stage.getAttribute("data-cao-requested-age-ma")))
    .toBeCloseTo(411, 8);
  await expect.poll(() => tileStarted).toBe(true);
  await expect(stage).toHaveAttribute("data-cao-motion-foreground-status", "loading");
  // The previously rendered surface stays on the globe with truthful
  // requested/displayed ages. Blanking it here flashed land on slow devices.
  await expect(stage).toHaveAttribute("data-cao-displayed-age-ma", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "ready");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "0");
  await expect(globe(page)).not.toHaveAttribute("data-cao-foundation-draw-count", "0");
  await expect(page.locator(".surface-info summary strong[role='status']"))
    .toHaveText("Loading 411 Ma · Showing Today");
  await expect(page.locator(".surface-info")).toHaveAttribute("data-status", "loading");
  releaseTile!();
  await waitForCao(page);
  await expect.poll(async () => Number(await globe(page)
    .getAttribute("data-cao-foundation-requested-age-ma"))).toBeCloseTo(411, 8);
  await expect.poll(async () => Number(await stage.getAttribute("data-cao-displayed-age-ma")))
    .toBeCloseTo(411, 8);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "");
});

test("withholds the surface when hash-qualified package bytes are corrupt", async ({ page }) => {
  await page.route(/\/data\/reconstruction\/cao-v2\.4\/core\.json\?h=/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}",
  }));
  await page.goto("./");
  await expect(page.locator(".surface-info")).toHaveAttribute("data-status", "error", { timeout: 20_000 });
  await expect(page.locator(".surface-info summary strong[role='status']")).toHaveText("Surface withheld");
  await expect(globe(page)).not.toHaveAttribute("data-cao-foundation-status", "ready");
});
test("supports the TSL WebGL2 fallback", { tag: "@ci" }, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./?renderer=webgl2");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-renderer-backend", "webgl2");
  expect(errors).toEqual([]);
});

for (const renderer of [
  { label: "automatic renderer", query: "", backend: null },
  { label: "WebGL2", query: "?renderer=webgl2", backend: "webgl2" },
]) {
  test(`keeps reconstructed surface lighting viewer-facing through an orbit gesture in ${renderer.label}`, async ({ page }) => {
    test.setTimeout(75_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`./${renderer.query}`);
    await waitForCao(page);
    const activeBackend = await globe(page).getAttribute("data-renderer-backend");
    expect(["webgpu", "webgl2"]).toContain(activeBackend);
    if (renderer.backend) expect(activeBackend).toBe(renderer.backend);
    if (renderer.query === "" && process.env.EARTHHISTORY_EXPECT_AUTO_WEBGPU === "1") {
      expect(activeBackend).toBe("webgpu");
    }
    const box = await globe(page).boundingBox();
    expect(box).not.toBeNull();
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    for (let index = 0; index < 2; index += 1) {
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(center.x - 400, center.y, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(1_000);
    }
    await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-longitude")))
      .toBeGreaterThan(100);
    await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "ready");
    await expect(globe(page)).toHaveAttribute("data-inspection-light-camera-dot", "1");

    const { land: landLuminance, ocean: oceanLuminance } = await screenshotLuminanceSamples(page);
    expect(landLuminance, `post-orbit land luminance in ${renderer.label}`).toBeGreaterThan(105);
    expect(landLuminance - oceanLuminance,
      `post-orbit land/ocean luminance separation in ${renderer.label}`).toBeGreaterThan(45);
  });
}

test("locks a global surface position without changing zoom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await waitForCao(page);
  await page.locator("#landscape-jump").selectOption("amazon-rainforest");
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "place");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-longitude")))
    .toBeCloseTo(-62, 1);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-latitude")))
    .toBeCloseTo(-4, 1);
  const box = await globe(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, 220);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeGreaterThan(3);
  const distance = Number(await globe(page).getAttribute("data-camera-distance"));
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "true");
  await expect(page.getByTestId("location-lock")).toContainText(/Location locked/);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distance, 3);
  await expect.poll(async () => {
    const xRaw = await globe(page).getAttribute("data-focus-marker-offset-x-px");
    const yRaw = await globe(page).getAttribute("data-focus-marker-offset-y-px");
    if (xRaw === null || yRaw === null) return Number.POSITIVE_INFINITY;
    const x = Number(xRaw);
    const y = Number(yRaw);
    return Number.isFinite(x) && Number.isFinite(y)
      ? Math.hypot(x, y) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distance, 3);
});

test("distinguishes exact native checkpoints from continuous motion", async ({ page }) => {
  await page.goto("./#age=450");
  await waitForCao(page);
  await expect(page.locator(".geography-age").first()).toContainText("450 Ma native Cao checkpoint");
  // Counts include the lake-void infill charts (source-qualified material with
  // model-inferred pose) active above their lake onsets: 91 at 410 Ma, 90 at 430 Ma.
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "94");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "11");
  await expect(globe(page)).toHaveAttribute("data-cao-formation-uncertain-material-charts", "1");
  await expect(page.locator("#source-age-jump")).toHaveValue("450");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "450");

  await page.goto("./#age=452.5");
  await page.reload();
  await waitForCao(page);
  await expect(page.locator(".geography-age").first()).toContainText("450–455 Ma native Cao controls");
  await expect(page.locator("#source-age-jump")).toHaveValue("interpolated");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "");
});

test("activates cited material corrections across exact evidence boundaries", async ({ page }) => {
  await page.goto("./#age=410");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-formation-range-material");
  // Counts include the lake-void infill charts (source-qualified material with
  // model-inferred pose) active above their lake onsets: 91 at 410 Ma, 90 at 430 Ma.
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "101");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-formation-uncertain-material-charts", "2");
  await expect(globe(page)).toHaveAttribute("data-cao-model-inferred-pose-charts", "101");

  await setContinuousAge(page, 410.0000001);
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-formation-range-material");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "106");
  await expect(globe(page)).toHaveAttribute("data-cao-formation-uncertain-material-charts", "2");
  await openSurfaceInfo(page);
  await expect(page.locator(".surface-evidence-key")).toContainText("Source-qualified material");

  await page.locator("#source-age-jump").selectOption("430");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "430");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "104");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "1");

  await setContinuousAge(page, 430.0000001);
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-formation-range-material");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "94");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "11");
  await openSurfaceInfo(page);
  await expect(page.locator(".surface-evidence-key")).toContainText("Model-inferred or uncertain material");
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Sources" }).click();
  await expect(page.getByRole("link", { name: /simplified tectonic assemblage map/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Geology, Svalbard/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Generalized Geologic Map/ })).toBeVisible();
});

test("retargets correction boundaries in one document with stable geometry", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  const geometryIdentity = await globe(page).getAttribute("data-cao-foundation-geometry-identity");
  const vertices = await globe(page).getAttribute("data-cao-foundation-vertices");
  expect(geometryIdentity).toBeTruthy();

  for (const ageMa of [410, 410.001, 430.001, 0]) {
    await setContinuousAge(page, ageMa);
    await expect(globe(page)).toHaveAttribute("data-cao-foundation-geometry-identity", geometryIdentity!);
    await expect(globe(page)).toHaveAttribute("data-cao-foundation-vertices", vertices!);
  }
  await expect(globe(page)).toHaveAttribute("data-cao-overridden-native-charts", "2");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "0");
});

test("withholds a failed checkpoint and recovers without stale land", async ({ page }) => {
  let failures = 0;
  await page.route("**/checkpoint-450ma.json*", async (route) => {
    if (failures++ === 0) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("./");
  await waitForCao(page);
  const geometryIdentity = await globe(page).getAttribute("data-cao-foundation-geometry-identity");
  await page.locator("#source-age-jump").selectOption("450");
  await expect(page.locator(".surface-info summary")).toContainText("Surface withheld");
  await expect(page.getByText(/Cao reconstruction unavailable · surface withheld/)).not.toBeVisible();
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "waiting");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-anchor-markers", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-anchor-age-ma", "");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "false");
  await setContinuousAge(page, 445.1);
  await waitForCao(page);
  await expect.poll(async () => Number(
    await globe(page).getAttribute("data-cao-foundation-anchor-age-ma"),
  )).toBeCloseTo(445.1, 6);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geometry-identity", geometryIdentity!);
  await expect(page.getByText(/Cao reconstruction unavailable/)).toHaveCount(0);
  await page.locator("#source-age-jump").selectOption("445");
  await waitForCao(page);
  await page.locator("#source-age-jump").selectOption("450");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "450");
});

test("cancels a stale checkpoint failure when a newer age takes priority", async ({ page }) => {
  let reject450: (() => Promise<void>) | undefined;
  await page.route("**/checkpoint-450ma.json*", async (route) => {
    await new Promise<void>((resolve) => {
      reject450 = async () => {
        await route.abort("failed");
        resolve();
      };
    });
  });
  await page.goto("./");
  await waitForCao(page);
  const geometryIdentity = await globe(page).getAttribute("data-cao-foundation-geometry-identity");
  await page.locator("#source-age-jump").selectOption("450");
  await expect.poll(() => reject450).toBeDefined();
  await page.locator("#source-age-jump").selectOption("445");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "445");
  await reject450!();
  const stage = page.locator(".globe-stage");
  await waitForCao(page);
  await expect(stage).not.toHaveAttribute("data-cao-last-prepare-failed-age-ma", "450");
  await expect(stage).not.toHaveAttribute("data-cao-last-prepare-failure-observed-age-ma", "445");
  await expect(stage).toHaveAttribute("data-cao-motion-foreground-status", "ready");
  await expect(stage).toHaveAttribute("data-cao-displayed-age-ma", "445");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "445");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geometry-identity", geometryIdentity!);
  await expect(page.getByText(/Cao reconstruction unavailable/)).toHaveCount(0);
});

test("labels editorial geography outside the live Cao package domain", async ({ page }) => {
  await page.goto("./#age=2000");
  await expect(globe(page)).toBeVisible();
  // Direct deep-time entry has no in-domain publish yet, so native geography is withheld.
  await expect.poll(() => globe(page).getAttribute("data-cao-foundation-status")).toBe("unsupported");
  await expect(page.locator(".geography-age").first()).toContainText("Outside compiled domain");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "unsupported-editorial-uniform");
  await expect(page.locator("#timeline-scale")).toContainText("Precambrian");
  await expect(page.locator("#timeline-scale option[value='recent']")).toHaveCount(0);
  await expect(page.locator(".timeline-direction")).toContainText("present");
});

test("clears correction legend state outside the live Cao package domain", async ({ page }) => {
  await page.goto("./#age=411");
  await waitForCao(page);
  await openSurfaceInfo(page);
  await expect(page.locator(".surface-evidence-key")).toContainText("Source-qualified material");
  await page.locator("#chapter-jump").selectOption("moon-forming-scenario");
  await expect(page.locator(".geography-age").first()).toContainText("Outside compiled domain");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "unsupported");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-draw-count", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-overridden-native-charts", "0");
  await expect(page.locator(".surface-evidence-key")).toContainText("No regional material correction evidence active");
});

test("labels observed modern land only at the exact present", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  // Iceland's two exact-present charts plus the thirteen land-omission charts.
  await expect(globe(page)).toHaveAttribute("data-cao-observed-material-charts", "15");
  await expect(globe(page)).toHaveAttribute("data-cao-classified-shallow-marine-charts", "2");
  await openSurfaceInfo(page);
  await expect(page.locator(".surface-evidence-key")).toContainText("Observed modern land");
  await expect(page.locator(".surface-evidence-key")).toContainText("Modern Iceland shelf · generalized 0–200 m class");

  await setContinuousAge(page, 0.001);
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-observed-material-charts", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-classified-shallow-marine-charts", "0");
  await openSurfaceInfo(page);
  await expect(page.locator(".surface-evidence-key")).not.toContainText("Observed modern land");
  await expect(page.locator(".surface-evidence-key")).not.toContainText("Modern Iceland shelf");
});

test("keeps the mobile map key compact and gives the timeline a touch-sized drag target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#age=411");
  await waitForCao(page);
  const info = page.locator(".surface-info");
  const summary = info.locator("summary");
  await expect(info).not.toHaveAttribute("open", "");
  const summaryBox = await summary.boundingBox();
  expect(summaryBox).not.toBeNull();
  expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
  expect(summaryBox!.height).toBeLessThanOrEqual(46);
  await expect(page.getByText("Land uses one display color. Evidence categories are listed separately.")).not.toBeVisible();
  await openSurfaceInfo(page);
  await expect(page.getByText("Land uses one display color. Evidence categories are listed separately.")).toBeVisible();
  await expect(page.getByText("Land", { exact: true })).toBeVisible();
  await expect(page.getByText(/Source-qualified material/)).toBeVisible();
  await expect(page.getByText(/exposure unknown/).first()).toBeVisible();

  const range = page.locator("#geological-age");
  const touchStyle = await range.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: Number.parseFloat(style.height), touchAction: style.touchAction };
  });
  expect(touchStyle.height).toBeGreaterThanOrEqual(44);
  expect(touchStyle.touchAction).toBe("none");
});

test("keeps touch scrubbing stable at the thumb and releases its local draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await waitForCao(page);
  const range = page.locator("#geological-age");
  const geometry = await range.evaluate((element) => {
    const input = element as HTMLInputElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    input.setPointerCapture = () => undefined;
    input.hasPointerCapture = () => false;
    input.releasePointerCapture = () => undefined;
    const rect = input.getBoundingClientRect();
    return { left: rect.left, width: rect.width, thumbRadius: 9.5 };
  });
  const dispatchPointer = async (
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
    pointerId: number,
    clientX: number,
    isPrimary = true,
  ) => range.dispatchEvent(type, { pointerId, pointerType: "touch", isPrimary, clientX });
  const sliderCenter = (position: number) => geometry.left + geometry.thumbRadius
    + (geometry.width - geometry.thumbRadius * 2) * position / 1000;

  await dispatchPointer("pointerdown", 41, sliderCenter(0));
  expect(Number(await range.inputValue())).toBeCloseTo(0, 6);
  await dispatchPointer("pointerdown", 42, sliderCenter(1000), false);
  expect(Number(await range.inputValue())).toBeCloseTo(0, 6);
  await dispatchPointer("pointermove", 41, sliderCenter(500));
  await expect.poll(async () => Number(await range.inputValue())).toBeCloseTo(500, 3);
  await dispatchPointer("pointercancel", 41, sliderCenter(500));
  await expect.poll(async () => Number(await range.inputValue())).toBeCloseTo(500, 3);

  await page.locator(".context-toggle").click();
  await page.locator("#chapter-jump").selectOption("silurian");
  await expect(range).toHaveAttribute("aria-valuetext", "430 Ma");
  const silurianPosition = Number(await range.inputValue());
  await dispatchPointer("pointerdown", 43, sliderCenter(silurianPosition));
  expect(Number(await range.inputValue())).toBeCloseTo(silurianPosition, 3);
  await dispatchPointer("pointermove", 43, sliderCenter(750));
  await expect.poll(async () => Number(await range.inputValue())).toBeCloseTo(750, 3);
  await dispatchPointer("lostpointercapture", 43, sliderCenter(750));
  await expect.poll(async () => Number(await range.inputValue())).toBeCloseTo(750, 3);
  await page.locator("#chapter-jump").selectOption("present");
  await expect(range).toHaveAttribute("aria-valuetext", "Today");
  expect(Number(await range.inputValue())).toBeCloseTo(0, 6);
});

test("keeps Precambrian scrubber from deep time through today", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await page.locator("#timeline-scale").selectOption("precambrian");
  await expect(page.locator("#timeline-scale")).toHaveValue("precambrian");
  // Switching into Precambrian must not jump away from today.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.locator("#geological-age")).toHaveValue("0");
  await page.locator("#geological-age").fill("1000");
  await expect.poll(async () => Number(await page.locator("#geological-age").inputValue())).toBe(1000);
  const deepLabel = await page.locator(".timeline-handle-label").innerText();
  expect(deepLabel).not.toMatch(/Today/i);
  await page.locator("#geological-age").fill("0");
  await expect(page.locator(".timeline-handle-label")).toHaveText("Today");
  await waitForCao(page);
});

test("keeps layers usable and states the unavailable data once", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const guides = page.getByRole("button", { name: /^Reference guides/ });
  await guides.click();
  await expect(globe(page)).toHaveAttribute("data-reference-guide-visible", "false");
  // The panel is controls only: drainage and seafloor were disabled rows a
  // viewer had to read past and are now one statement under the relief slider.
  await expect(page.getByRole("button", { name: /unavailable/i })).toHaveCount(0);
  await expect(page.getByText(/no reconstructed river field and no qualified ocean-floor age or depth/i))
    .toBeVisible();
});

test("draws the Cao 2017 map by default in a link that names no layers", async ({ page }) => {
  // The mapped palaeogeography is what a visitor arrives at. A link with no
  // `layers=` takes the defaults, so 90 Ma comes up on its published interval
  // and the country outline carries both tones.
  await page.goto("./#age=90");
  await waitForCao(page);
  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const palaeo = page.getByRole("button", { name: /^Realistic coastlines/ });
  await expect(palaeo).toBeEnabled();
  await expect(palaeo).toHaveAttribute("aria-pressed", "true");
  // The long Cao 2017 statement moved to the map key; the row keeps one line.
  await expect(page.getByText(/steps between 24 published map intervals/)).toHaveCount(0);
  await expect(page.getByText(/Cao et al\. 2017 mapped land, shallow seas and mountains/)).toBeVisible();
  await expect(page.getByText(/Cao 2017 map charts are not in this build/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "94-81");
  expect(Number(await globe(page).getAttribute("data-cao-outline-tone-light-segments")))
    .toBeGreaterThan(0);
});

test("fetches no palaeo bytes when a link switches the layer off", async ({ page }) => {
  // The "zero palaeo bytes when off" contract now needs an explicit link: the
  // default is on, and a `layers=` list that does not name the layer keeps it
  // off, which is the same contract a link written before the layer existed has.
  const palaeoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("palaeo-coastlines/")) palaeoRequests.push(request.url());
  });
  await page.goto("./#age=90&layers=borders,guides");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-interval-id", "");
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-light-segments", "0");
  const darkSegments = Number(await globe(page)
    .getAttribute("data-cao-outline-tone-dark-segments"));
  expect(darkSegments).toBeGreaterThan(10_000);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const palaeo = page.getByRole("button", { name: /^Realistic coastlines/ });
  await expect(palaeo).toBeEnabled();
  await expect(palaeo).toHaveAttribute("aria-pressed", "false");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-coastline-mode", "off");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-asset-bytes", "0");
  expect(palaeoRequests, "no palaeo bytes are fetched while the layer is off").toEqual([]);
});

test("draws the Cao 2017 map with separable land, shallow sea and shelf", async ({ page }) => {
  // Idle rotation would move the lit limb between screenshots.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=90&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "94-81");
  expect(Number(await globe(page).getAttribute("data-cao-palaeo-triangles"))).toBeGreaterThan(0);
  expect(Number(await globe(page).getAttribute("data-cao-palaeo-charts"))).toBeGreaterThan(0);
  expect(Number(await globe(page).getAttribute("data-cao-palaeo-asset-bytes"))).toBeGreaterThan(0);

  // Two tones on the country outline: dark ink over the Cao 2017 land, light
  // over its seas. A build that uploaded no table would keep every segment dark.
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-interval-id", "94-81");
  expect(Number(await globe(page).getAttribute("data-cao-outline-tone-dark-segments")))
    .toBeGreaterThan(0);
  expect(Number(await globe(page).getAttribute("data-cao-outline-tone-light-segments")))
    .toBeGreaterThan(0);

  const painted = await paintedSurfaceClasses(page);
  // The three classes must be separable on screen, not only in the manifest.
  expect(painted.land.pixels, "palaeo land pixels").toBeGreaterThan(500);
  expect(painted.shallow.pixels, "palaeo shallow-marine pixels").toBeGreaterThan(500);
  expect(painted.shelf.pixels, "shelf pixels").toBeGreaterThan(500);
  expect(painted.land.luminance).toBeGreaterThan(105);
  expect(painted.land.luminance - painted.shelf.luminance).toBeGreaterThan(45);
  expect(painted.shallow.luminance).toBeGreaterThan(painted.shelf.luminance);
});

test("places the compiled Cao 2017 witnesses on the live surface", async ({ page }) => {
  // The same witnesses `palaeo_coastlines_correction.py` asserts offline, read
  // back through the scene's own CPU coverage path.
  await page.goto("./#age=90&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  const classify = (longitude: number, latitude: number) => page.evaluate(
    ([lon, lat]) => window.__earthHistorySurfaceProbe?.(lon, lat) ?? "no-probe",
    [longitude, latitude]);
  expect(await classify(-100, 45), "Western Interior Seaway").toBe("palaeo-shallow-marine");
  expect(await classify(75, 60), "West Siberian Sea").toBe("palaeo-shallow-marine");
  expect(await classify(-90, 55), "Canadian Shield").toBe("palaeo-land");

  // A hash-only change does not reload, and the witness table is per interval.
  await page.goto("./#age=255&layers=borders,guides,palaeoCoastlines");
  await page.reload();
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "269-248");
  expect(await classify(4, 54), "Zechstein basin").toBe("palaeo-shallow-marine");
});

test("returns the Cao 2024 composition when the palaeo layer is switched off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=90&layers=borders,guides");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-coastline-mode", "off");
  const control = await globeLuminance(page);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const palaeo = page.getByRole("button", { name: /^Realistic coastlines/ });
  await palaeo.click();
  await page.keyboard.press("Escape");
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  // The mapped shallow seas are the change, and the surface probe names them.
  expect(await page.evaluate(() => window.__earthHistorySurfaceProbe?.(-100, 45) ?? "no-probe"))
    .toBe("palaeo-shallow-marine");
  expect(Number(await globe(page).getAttribute("data-cao-palaeo-triangles"))).toBeGreaterThan(0);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await palaeo.click();
  await page.keyboard.press("Escape");
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("off");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-charts", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-triangles", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-interval-id", "");
  expect(await globeLuminance(page)).toBeCloseTo(control, 0);
  expect(await page.evaluate(() => window.__earthHistorySurfaceProbe?.(-100, 45) ?? "no-probe"))
    .not.toBe("palaeo-shallow-marine");
});

test("crosses exactly one Cao 2017 map interval when scrubbing 94 to 80 Ma", async ({ page }) => {
  // Six interval loads in one page, each allowed 30 s of its own: the file-level
  // 45 s budget was never enough for the sum and only passed while every load
  // was warm.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#age=94&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "94-81");
  const observed: string[] = [];
  for (const ageMa of [92, 88, 84, 82, 80]) {
    await setContinuousAge(page, ageMa);
    await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
      { timeout: 30_000 }).toBe("on");
    const intervalId = await globe(page).getAttribute("data-cao-palaeo-interval-id");
    if (observed[observed.length - 1] !== intervalId) observed.push(intervalId!);
    // The mode never drops into an error state mid-scrub.
    expect(await globe(page).getAttribute("data-cao-palaeo-fallback-reason") ?? "").toBe("");
  }
  expect(observed).toEqual(["94-81", "81-58"]);
  expect(errors).toEqual([]);
});

test("names the Cao 2017 map interval and outline markers in the map key", async ({ page }) => {
  await page.goto("./#age=90&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await openSurfaceInfo(page);
  await expect(page.getByTestId("palaeo-map-key")).toBeVisible();
  await expect(page.getByTestId("palaeo-interval-line"))
    .toHaveText("Cao et al. (2017) map interval 94\u201381 Ma");
  await expect(page.getByText(/minimum land \/ maximum flooding recorded anywhere in that bin/)).toBeVisible();
  await expect(page.getByText(/Cao 2024 continental crust, depth unmapped/)).toBeVisible();
  await expect(page.getByText(/Light grey outline · over shallow or deep sea/)).toBeVisible();
  await expect(page.getByText(/Outline tone is a legibility device, not evidence/)).toBeVisible();
  await expect(page.getByTestId("timeline-interval-marks").locator(".interval-mark"))
    .toHaveCount(24);

  // Only the classes this build publishes get a swatch, and all three do since
  // the mountain class shipped: withholding it painted emergent orogen as crust
  // of unmapped depth.
  await expect(page.getByText("Palaeo land", { exact: true })).toBeVisible();
  await expect(page.getByText("Palaeo shallow sea", { exact: true })).toBeVisible();
  await expect(page.getByText("Palaeo mountain", { exact: true })).toBeVisible();

  // Nothing in the key is left below the fold with no way to reach it: the
  // panel takes the height the stage leaves it, and scrolls the remainder.
  const panel = page.locator(".surface-info-panel");
  const metrics = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom }));
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(900);
  expect(metrics.clientHeight, "map key panel height at 1440x900").toBeGreaterThan(440);
  const last = page.getByText(/Outline tone is a legibility device, not evidence/);
  await last.scrollIntoViewIfNeeded();
  const lastBox = (await last.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
});

test("shows the palaeo fallback notice where no Cao 2017 map exists", async ({ page }) => {
  await page.goto("./#age=0&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await openSurfaceInfo(page);
  await expect(page.getByTestId("palaeo-fallback-notice"))
    .toHaveText("No palaeogeography evidence at this age; showing the Cao 2024 coast proxy");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-coastline-mode", "fallback");
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-interval-id", "");
  // The live wiring reports what is drawn, not what the age asks for. In a
  // fallback nothing is published and nothing of what the mode holds resident
  // reaches the screen, and every counter says so.
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-asset-bytes", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-charts", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-triangles", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-fallback-reason",
    "age-outside-cao-2017-map-intervals");
});

// The fallback is a composition, not just a notice. Native land is hidden only
// while palaeo charts are drawn over it; at an age with no Cao 2017 map the
// palaeo instance draws nothing, so hiding it left the shelf shining through -
// Africa as shallow sea at 0 Ma. Both ends of the domain, each against its own
// layer-off control, and one page load each so the pair stays inside the
// per-test budget.
for (const view of [{ ageMa: 0, at: "5,25" }, { ageMa: 500, at: "-100,-10" }]) {
  test(`composes exactly today's globe at ${view.ageMa} Ma, where no Cao 2017 map exists`,
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`./#age=${view.ageMa}&layers=borders,guides&at=${view.at}`);
      await waitForCao(page);
      await expect(globe(page)).toHaveAttribute("data-cao-palaeo-coastline-mode", "off");
      const control = await globeCanvasImage(page);
      const controlClasses = await paintedSurfaceClasses(page, control);
      expect(controlClasses.land.pixels, "control land pixels").toBeGreaterThan(5_000);

      await page.goto(`./#age=${view.ageMa}&layers=borders,guides,palaeoCoastlines&at=${view.at}`);
      await page.reload();
      await waitForCao(page);
      await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
        { timeout: 30_000 }).toBe("fallback");
      const fallback = await globeCanvasImage(page);
      const difference = await globeImageDifference(page, control, fallback);
      expect(difference.meanAbsoluteDifference, "mean channel difference").toBeLessThan(1);
      const fallbackClasses = await paintedSurfaceClasses(page, fallback);
      expect(Math.abs(fallbackClasses.land.pixels - controlClasses.land.pixels)
        / controlClasses.land.pixels, "land pixel change").toBeLessThan(0.005);
    });
}

test("keeps today's land when the palaeo layer is switched on at 0 Ma", async ({ page }) => {
  // The same contract through the control rather than the link: a viewer who
  // turns the layer on at the present day must not watch the continents go.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=0&layers=borders,guides&at=5,25");
  await page.reload();
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-coastline-mode", "off");
  const control = await paintedSurfaceClasses(page);
  expect(control.land.pixels, "control land pixels").toBeGreaterThan(5_000);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await page.getByRole("button", { name: /^Realistic coastlines/ }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("fallback");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-triangles", "0");
  const toggled = await paintedSurfaceClasses(page);
  expect(Math.abs(toggled.land.pixels - control.land.pixels) / control.land.pixels,
    "land pixel change after the toggle").toBeLessThan(0.005);
  // And the pick agrees with the picture: land, not the shelf under it.
  expect(await page.evaluate(() => window.__earthHistorySurfaceProbe?.(20, 5) ?? "no-probe"))
    .toBe("land");
});

test("leaves the palaeo layer off in a link written before it existed", async ({ page }) => {
  await page.goto("./#age=90&layers=borders,guides");
  await waitForCao(page);
  await openSurfaceInfo(page);
  await expect(page.getByTestId("palaeo-map-key")).toHaveCount(0);
  await expect(page.getByTestId("timeline-interval-marks")).toHaveCount(0);
  await expect(page.getByText(/Continental shelf context; ancient water depth unknown/)).toBeVisible();
});

/** Six wheel steps in, the framing the closest-zoom review captures use. */
async function zoomToClosest(page: Page) {
  const box = await globe(page).boundingBox();
  if (box === null) throw new Error("the globe canvas has no box to zoom into");
  // Zoom is anchored on the cursor, so it sits exactly where `at=` centred the
  // site: the ground under the pointer is the ground still under it afterwards.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
}

/**
 * Pixels that read as water, crust or the bare sphere while almost every pixel
 * around them reads as land, and the largest run of them.
 *
 * Every land-like tone the globe draws - native land, corrections, palaeo-land,
 * palaeo-mountain - is warm: red is at least as strong as blue once the ACES
 * curve and the sRGB transfer have run. Every class *below* them is cold: the
 * shelf, palaeo-shallow-marine and the ocean sphere all render with blue well
 * ahead of red. A real coastline is a long cold region whose pixels have cold
 * neighbours; a cold pixel in an otherwise warm neighbourhood is a lower class
 * showing through a higher one - a cookie-cut seam, a sliver, or a shell
 * interpenetration - wherever on the globe it happens to be.
 *
 * Counting the whole canvas rather than a window means the measurement does not
 * depend on where the camera put a named place.
 */
async function isolatedColdPixels(page: Page) {
  const screenshot = await globe(page).screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("stacking census canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const { width, height } = bitmap;
    const pixels = context.getImageData(0, 0, width, height).data;
    const cold = new Uint8Array(width * height);
    let coldTotal = 0;
    let warmTotal = 0;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const red = pixels[offset]!;
      const blue = pixels[offset + 2]!;
      if (blue - red > 20) { cold[index] = 1; coldTotal += 1; } else if (red - blue > 10) warmTotal += 1;
    }
    let isolated = 0;
    let longestRun = 0;
    for (let y = 1; y < height - 1; y += 1) {
      let run = 0;
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!cold[index]) { run = 0; continue; }
        let warmNeighbours = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            if (!cold[index + dy * width + dx]) warmNeighbours += 1;
          }
        }
        if (warmNeighbours >= 7) {
          isolated += 1;
          run += 1;
          longestRun = Math.max(longestRun, run);
        } else run = 0;
      }
    }
    bitmap.close();
    return { isolated, longestRun, coldTotal, warmTotal, pixels: width * height };
  }, screenshot.toString("base64"));
}

async function probeClass(page: Page, longitude: number, latitude: number) {
  return page.evaluate(([lon, lat]) =>
    window.__earthHistorySurfaceProbe?.(lon, lat) ?? "no-probe", [longitude, latitude]);
}

// The stacking contract, checked where it can actually fail: at the closest zoom
// the review captures use, on three overlapping sites, one per pair of classes
// that share ground. Deep sea and shelf are at the bottom, then shallow marine,
// then corrections, then palaeo-land, then palaeo-mountain; nothing lower may
// show through anything higher. `caoFoundation.test.ts` asserts the shells and
// the draw order; this asserts the pixels they produce.
for (const site of [
  { id: "mountain over land", age: 90, at: "68.61,-32.34", probe: [85, 29] as const,
    expected: "palaeo-mountain",
    why: "Tethyan Himalaya: the mountain class drawn over the land class" },
  { id: "land over shallow sea", age: 170, at: "23.48,41.98", probe: [-4, 57] as const,
    expected: "palaeo-land",
    why: "the Scottish Middle Jurassic landmass inside the North Sea shallow sea" },
  { id: "LGM shelf over shallow sea", age: 0.021, at: "3,57", probe: [3, 57] as const,
    expected: "palaeo-land",
    why: "the exposed central North Sea shelf at the lowstand" },
]) {
  test(`draws no lower class inside the higher one: ${site.id}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`./#age=${site.age}&layers=borders,guides,palaeoCoastlines&at=${site.at}`);
    await waitForCao(page);
    await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
      { timeout: 30_000 }).toBe("on");
    expect(await probeClass(page, site.probe[0], site.probe[1]), site.why).toBe(site.expected);
    await zoomToClosest(page);
    const census = await isolatedColdPixels(page);
    // The frame must actually show both classes, or the measurement is vacuous.
    expect(census.warmTotal, `${site.id}: no land-like pixels in frame`).toBeGreaterThan(20_000);
    expect(census.coldTotal, `${site.id}: no lower-class pixels in frame`).toBeGreaterThan(2_000);
    // A cookie-cut hairline is a long run of cold pixels in a warm field: the
    // 170 Ma review capture carried one 106 px long. Bound the run, not just the
    // count, because a handful of scattered antialiasing pixels is not a seam.
    expect(census.longestRun,
      `${site.id}: ${census.isolated} isolated cold pixels, longest run ${census.longestRun}`)
      .toBeLessThanOrEqual(12);
  });
}

test("reaches the LGM interval after a long scrub through the Cao band", async ({ page }) => {
  // One page, many intervals. The defect this covers only appeared after a dozen
  // interval changes: every trip out of the published domain cleared the palaeo
  // publication, each clear handed the bounded GPU retirement owner a resource it
  // refused, and the refused bytes stayed in the publisher's ledger forever until
  // the next publication no longer fit. The layer then latched at "loading" with
  // the globe drawn as if it were off, because the pump believed its own
  // bookkeeping and never asked again.
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=90&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");

  // Thirteen Cao 2017 intervals, one after another in the same page. The gap
  // ages between them are what tear the publication down.
  const ages = [90, 75, 60, 45, 30, 20, 12, 8, 5, 3, 120, 170, 250];
  for (const age of ages) {
    await setContinuousAge(page, age);
    await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
      { timeout: 30_000, message: `palaeo-coastline mode at ${age} Ma` }).toBe("on");
    expect(await globe(page).getAttribute("data-cao-palaeo-fallback-reason"),
      `a refused publication at ${age} Ma`).toBe("");
  }

  await setContinuousAge(page, 0.021);
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-band", "lgm");
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 10_000 }).toBe("on");
  await expect(globe(page)).toHaveAttribute("data-cao-palaeo-interval-id", "lgm");
  // The discriminator: a refused publication names itself here, and an empty
  // string is the only reading that says nothing refused it.
  expect(await globe(page).getAttribute("data-cao-palaeo-fallback-reason")).toBe("");
});

test("keeps the open map key clear of the chapter card on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#age=170&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await openSurfaceInfo(page);
  const panel = await page.locator(".surface-info-panel").boundingBox();
  const chapter = await page.locator(".context-panel").boundingBox();
  expect(panel).not.toBeNull();
  // 390 px leaves no room for both: the open key is the width of the screen and
  // reaches most of its height, so the chapter card may not occupy any of the
  // same pixels. Either it is not laid out at all, or it is somewhere else.
  if (chapter !== null) {
    const intersects = panel!.x < chapter.x + chapter.width
      && chapter.x < panel!.x + panel!.width
      && panel!.y < chapter.y + chapter.height
      && chapter.y < panel!.y + panel!.height;
    expect(intersects, "the open map key overlaps the chapter card").toBe(false);
  }
});

test("keeps the palaeo map key compact on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#age=90&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await openSurfaceInfo(page);
  const panel = page.locator(".surface-info-panel");
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  // The key gains three swatches, a legend and three sentences; it must stay
  // inside the phone viewport rather than running under the timeline.
  expect(panelBox!.width).toBeLessThanOrEqual(390);
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(844);
  await expect(page.getByTestId("palaeo-map-key")).toBeVisible();
});

test("keeps unlocalized evidence off the globe", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  await page.locator("#chapter-jump").selectOption("jack-hills-oceans");
  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await page.getByRole("button", { name: /Jack Hills zircon and early water/ }).click();
  await expect(page.getByText("This note has no defensible map position in this chapter.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Locate on globe" })).toHaveCount(0);
});

test("uses source-qualified POI anchors and preserves zoom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await waitForCao(page);
  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await page.getByRole("button", { name: /Andean volcanic margin/ }).click();
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "poi");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.83);
  await page.waitForTimeout(250);
  const distance = Number(await globe(page).getAttribute("data-camera-distance"));
  await page.locator("#chapter-jump").selectOption("neogene");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "poi");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distance, 2);
});

test("retains a material address through an unsupported age and reacquires without resetting zoom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await waitForCao(page);
  await page.locator("#landscape-jump").selectOption("amazon-rainforest");
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "place");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeLessThanOrEqual(1.83);
  const box = await globe(page).boundingBox();
  expect(box).not.toBeNull();
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  // The first click clears the editorial preset while retaining its camera;
  // the second ray hits the same known Amazonian land through the native mesh.
  await page.mouse.click(center.x, center.y);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  const distanceBeforeLock = Number(await globe(page).getAttribute("data-camera-distance"));
  await page.mouse.click(center.x, center.y);
  await expect.poll(() =>
    new URLSearchParams(new URL(page.url()).hash.slice(1)).get("material"),
  ).not.toBeNull();
  const material = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("material");
  expect(material).not.toBeNull();
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "true");
  await expect(globe(page)).toHaveAttribute("data-focus-marker-style", "steady-ring-dot");
  await expect(globe(page)).toHaveAttribute("data-focus-marker-size-px", "18");
  await expect(page.getByTestId("location-lock")).toContainText(/Location locked/);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distanceBeforeLock, 3);
  await page.mouse.move(center.x, center.y);
  for (let index = 0; index < 4; index++) await page.mouse.wheel(0, -220);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.75);
  const distance = Number(await globe(page).getAttribute("data-camera-distance"));

  await page.locator("#chapter-jump").selectOption("rhyacian");
  // Last in-domain foundation may remain visible; tagged material is retained
  // while follow pose/marker clear until support returns.
  await expect(page.getByTestId("location-lock")).toContainText(/unavailable at this age/);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "false");
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("material")).toBe(material);
  await page.locator("#chapter-jump").selectOption("present");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "true");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distance, 2);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "false");
  await expect(page.getByTestId("location-lock")).toHaveCount(0);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(distance, 3);
});

test("keeps the menu and modal keyboard accessible", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await menuButton.focus();
  await menuButton.press("Enter");
  const first = page.getByRole("menuitem", { name: /^Layers & relief/ });
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Sources" }).click();
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
});

test("keeps mobile globe and controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await waitForCao(page);
  const stage = await page.locator(".globe-stage").boundingBox();
  expect(stage).not.toBeNull();
  expect(stage!.x).toBeGreaterThanOrEqual(0);
  expect(stage!.x + stage!.width).toBeLessThanOrEqual(390);
  const toggle = page.getByRole("button", { name: /Current period Quaternary/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
});

test("resolves a cited reference for every chapter", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForCao(page);
  const picker = page.locator("#chapter-jump");
  const ids = await picker.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  for (const id of ids) {
    await picker.selectOption(id);
    await expect(page.locator(".chapter-reference a")).toHaveAttribute("href", /^https?:\/\//);
  }
});

test("does not blank the Cao foundation when scrubbing to today", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  await page.locator("#source-age-jump").selectOption("100");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "100");
  const verticesAt100 = Number(await globe(page).getAttribute("data-cao-foundation-vertices"));
  expect(verticesAt100).toBeGreaterThan(100_000);

  await page.locator("#source-age-jump").selectOption("0");
  await expect.poll(() => globe(page).getAttribute("data-cao-foundation-requested-age-ma")).toBe("0");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "ready");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-model-pose-material");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-cao-foundation-vertices")))
    .toBe(verticesAt100);
  await expect.poll(async () => Number(await globe(page).getAttribute("data-cao-foundation-draw-count")))
    .toBeGreaterThan(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.getByText(/Cao reconstruction unavailable/)).toHaveCount(0);
});

/**
 * The three lighting bands the palaeo tone census reports.
 *
 * The scene lights the globe with an inspection light on the camera axis, so
 * `cosLight` runs from 1 at the sub-camera point to 0 at the terminator and one
 * orbital frame contains the whole range. A class's rendered tone is not its
 * base colour anywhere, and it is furthest from it in full light, where the ACES
 * curve's shoulder pulls every bright surface toward white: the contract has to
 * hold at the hardest band, not on average.
 */
const PALAEO_TONE_BANDS = [
  { id: "full light", min: 0.9, max: 1.01, predicted: [196, 114, 68] as const, minInkContrast: 3 },
  { id: "mid", min: 0.55, max: 0.72, predicted: [177, 95, 55] as const, minInkContrast: 3 },
  { id: "terminator-near", min: 0.2, max: 0.32, predicted: [143, 69, 37] as const,
    minInkContrast: 2 },
] as const;

/**
 * How far a measured channel may sit from its predicted value.
 *
 * The `predicted` triples above are *predictions*, not measurements: they come
 * from the band model in `caoFoundation.ts` - the per-band light factors 1.0355
 * / 0.7970 / 0.5260 fitted to the three tones 0.1.12 measured for `#fd7328`,
 * then ACES at exposure 1.02 and the sRGB transfer - solved for the new albedo
 * `#71220e`. Refitting that model against 0.1.12's own measured tones reproduces
 * them to within 9/255 at the worst channel, so a tolerance of 20 is the model's
 * demonstrated error with room to spare, and is tight enough that the class
 * cannot drift back toward the light tan it used to be (235,198,139 is 84 away
 * in red at full light). A run of this census is what turns the predictions into
 * measurements; until it has run, the numbers above are unconfirmed.
 */
const PALAEO_TONE_PREDICTION_TOLERANCE = 20;

/**
 * Camera aims the census samples from.
 *
 * Only ground inside the horizon is drawn and the horizon sits at
 * `cos = 1 / distance`, so a close view cannot reach the terminator at all. The
 * aims carry one mountain belt through the three bands by rotating the camera
 * around it. The belt is the densest palaeo-mountain ground the 94-81 Ma
 * interval draws, found by sweeping the pixel probe over a whole frame:
 * renderer-frame direction (32.98, -16.59). At latitude -16.59 a longitude
 * offset of 52.6 degrees puts that ground at cos 0.64 and 78.8 degrees at
 * cos 0.26, and each frame's other mountains and landmasses join whichever band
 * their own ground falls in.
 */
const PALAEO_TONE_CENSUS_VIEWS = [
  { at: "32.98,-16.59", why: "the densest mountain ground at the sub-camera point" },
  { at: "85.58,-16.59", why: "the same belt at cos 0.64" },
  { at: "-19.62,-16.59", why: "the same belt at cos 0.64, the other way" },
  { at: "111.78,-16.59", why: "the same belt at cos 0.26" },
  { at: "-45.82,-16.59", why: "the same belt at cos 0.26, the other way" },
] as const;

/**
 * One camera distance for every view, near the orbit control's own ceiling of
 * 6.2 Earth radii.
 *
 * The distance is part of the measurement, not a convenience. The horizon sits
 * at `cos = 1 / distance`, so a closer view cannot reach the terminator at all;
 * and the atmosphere shell darkens ground approaching the limb, which would
 * otherwise charge a class's *tone* for how close its band happened to sit to
 * the edge of a particular frame. Holding the distance fixed makes the only
 * difference between the bands the lighting they were shaded at: measured at
 * 5.6 the same mid band reads 202,201,169 where a 2.2 view reads 163,164,136.
 */
const PALAEO_TONE_CENSUS_CAMERA_DISTANCE = 5.6;

/** Probe grid pitch in CSS pixels; the globe is about 410 px across at 5.6. */
const PALAEO_TONE_CENSUS_STEP_CSS_PX = 10;

/**
 * The dark country-outline/label ink, as the sRGB bytes it is authored in.
 *
 * The comparison is against the authored ink, which is what
 * `caoFoundation.test.ts` also measures against, so the two agree. The ink is
 * drawn by a tone-mapped material and so reaches the screen lighter than this;
 * the number here is a colour-choice contract, not a measured on-screen ratio.
 */
const PALAEO_DARK_INK: readonly [number, number, number] = [31, 38, 46];

type ToneSample = { readonly rgb: [number, number, number]; readonly count: number };
type ToneCensus = Record<string, Record<string, ToneSample>>;

/**
 * Median rendered tone per surface class per lighting band over one frame.
 *
 * Ground truth is the scene's own composite pick, not the pixel colour, so the
 * census cannot assume the answer it is measuring. Each probed point is reduced
 * to the per-channel median of its 3x3 neighbourhood and the band's answer is
 * the per-channel median over its points, which survives the handful of
 * coastline-edge and antialiasing pixels a coarse grid lands on.
 */
async function palaeoToneCensus(page: Page, stepCssPx: number): Promise<ToneCensus> {
  const screenshot = (await globe(page).screenshot()).toString("base64");
  const box = await globe(page).boundingBox();
  if (box === null) throw new Error("the globe canvas has no box to census");
  const bands = PALAEO_TONE_BANDS.map((band) => ({ ...band }));
  return page.evaluate(async ([base64, left, top, width, height, step, lighting]) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("tone census canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const scaleX = bitmap.width / width;
    const scaleY = bitmap.height / height;
    const median = (values: number[]) =>
      values.sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
    const collected = new Map<string, number[][]>();
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        // The canvas carries the application's own chrome above it, and an
        // element screenshot photographs that chrome too. A pixel the pointer
        // could not reach is a pixel the census must not read: the surface pick
        // is a scene query and would happily answer for ground behind a panel.
        const topmost = document.elementFromPoint(left + x, top + y);
        if (topmost === null || topmost.tagName !== "CANVAS") continue;
        const px = Math.round(x * scaleX);
        const py = Math.round(y * scaleY);
        if (px < 1 || py < 1 || px >= bitmap.width - 1 || py >= bitmap.height - 1) continue;
        // Space is rejected on the photograph before the scene is asked. The
        // pick walks charts per ray and is far and away the cost here, and a
        // pixel showing the 0x010507 background cannot be a surface class.
        const centre = (py * bitmap.width + px) * 4;
        if (Math.max(pixels[centre]!, pixels[centre + 1]!, pixels[centre + 2]!) < 14) continue;
        const hit = window.__earthHistoryPixelSurfaceProbe?.(x, y) ?? null;
        if (hit === null) continue;
        const band = lighting.find((entry) =>
          hit.cosLight >= entry.min && hit.cosLight < entry.max);
        if (band === undefined) continue;
        const patch: number[][] = [[], [], []];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const offset = ((py + dy) * bitmap.width + (px + dx)) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              patch[channel]!.push(pixels[offset + channel]!);
            }
          }
        }
        const key = `${hit.surfaceClass}|${band.id}`;
        if (!collected.has(key)) collected.set(key, [[], [], []]);
        const target = collected.get(key)!;
        for (let channel = 0; channel < 3; channel += 1) {
          target[channel]!.push(median(patch[channel]!));
        }
      }
    }
    bitmap.close();
    const census: Record<string, Record<string, { rgb: [number, number, number]; count: number }>> = {};
    for (const [key, channels] of collected) {
      const [surfaceClass, band] = key.split("|") as [string, string];
      census[surfaceClass] ??= {};
      census[surfaceClass]![band] = {
        rgb: [median(channels[0]!), median(channels[1]!), median(channels[2]!)],
        count: channels[0]!.length,
      };
    }
    return census;
  }, [screenshot, box.x, box.y, box.width, box.height, stepCssPx, bands] as const);
}

/** Wheel the camera out until it is within 0.05 Earth radii of `distance`. */
async function zoomToDistance(page: Page, distance: number) {
  const box = await globe(page).boundingBox();
  if (box === null) throw new Error("the globe canvas has no box to zoom");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 60; step += 1) {
    const current = Number(await globe(page).getAttribute("data-camera-distance") ?? 0);
    if (Math.abs(current - distance) <= 0.05) return;
    await page.mouse.wheel(0, current < distance ? 120 : -120);
    await page.waitForTimeout(90);
  }
}

/** Merge censuses taken from several camera aims into one sample set. */
function mergeToneCensus(censuses: readonly ToneCensus[]): ToneCensus {
  const merged: ToneCensus = {};
  for (const census of censuses) {
    for (const [surfaceClass, bands] of Object.entries(census)) {
      merged[surfaceClass] ??= {};
      for (const [band, sample] of Object.entries(bands)) {
        const held = merged[surfaceClass]![band];
        // Weighted by sample count: the aims differ only in how much of each
        // class each one happens to show.
        merged[surfaceClass]![band] = held === undefined ? sample : {
          count: held.count + sample.count,
          rgb: held.rgb.map((value, index) => Math.round(
            (value * held.count + sample.rgb[index]! * sample.count)
            / (held.count + sample.count))) as [number, number, number],
        };
      }
    }
  }
  return merged;
}

const relativeLuminance = (rgb: readonly [number, number, number]) =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/**
 * Separation between two rendered tones after the brighter one is scaled to the
 * other's luma, in 0-255 units.
 *
 * Lightness is not the discriminator being asked for: two classes may legibly
 * differ in lightness alone and still read as "the same colour, lit differently"
 * on a sphere whose lighting already varies by more than the class difference.
 * Matching luma first leaves only the chromatic difference, which is the part a
 * viewer reads as "a different kind of ground".
 */
function lumaMatchedSeparation(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const scale = relativeLuminance(a) / relativeLuminance(b);
  return Math.max(...a.map((value, index) => Math.abs(value - b[index]! * scale)));
}

function hueDegrees(rgb: readonly [number, number, number]): number {
  const [red, green, blue] = rgb;
  const max = Math.max(red, green, blue);
  const span = max - Math.min(red, green, blue);
  if (span === 0) return 0;
  const hue = 60 * (max === red ? ((green - blue) / span) % 6
    : max === green ? (blue - red) / span + 2 : (red - green) / span + 4);
  return hue < 0 ? hue + 360 : hue;
}

function inkContrastRatio(rgb: readonly [number, number, number],
  ink: readonly [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (colour: readonly [number, number, number]) =>
    0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
  const [high, low] = [luminance(rgb), luminance(ink)].sort((left, right) => right - left);
  return (high! + 0.05) / (low! + 0.05);
}

test("draws palaeo mountains as a readable dark reddish brown at every lighting band", async ({ page }) => {
  test.setTimeout(420_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const censuses: ToneCensus[] = [];
  for (const [index, view] of PALAEO_TONE_CENSUS_VIEWS.entries()) {
    // No borders and no guides: an outline or a label drawn over the ground
    // would be the only ink in the frame that is not a surface class. The
    // per-view query parameter is what makes each aim a real navigation: a URL
    // that differs only in its fragment does not reload, and the camera would
    // stay where the first aim put it while the census believed it had moved.
    await page.goto(`./?census=${index}#age=90&layers=palaeoCoastlines&at=${view.at}`);
    await waitForCao(page);
    await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
      { timeout: 30_000 }).toBe("on");
    await zoomToDistance(page, PALAEO_TONE_CENSUS_CAMERA_DISTANCE);
    await page.waitForTimeout(900);
    censuses.push(await palaeoToneCensus(page, PALAEO_TONE_CENSUS_STEP_CSS_PX));
  }
  const census = mergeToneCensus(censuses);
  // Every band is measured before any of them is asserted, so one run reports
  // the whole census whether it passes or fails: a tone change has to be read
  // from the numbers it produced, not from the first threshold it crossed.
  const report: Record<string, unknown> = {};
  const rows = PALAEO_TONE_BANDS.map((band) => {
    const land = census["palaeo-land"]?.[band.id];
    const mountain = census["palaeo-mountain"]?.[band.id];
    if (land === undefined || mountain === undefined) {
      report[band.id] = { land: land ?? null, mountain: mountain ?? null };
      return { band, land, mountain, separation: 0, hue: 0, contrast: 0 };
    }
    const separation = lumaMatchedSeparation(mountain.rgb, land.rgb);
    const hue = hueDegrees(mountain.rgb);
    const contrast = inkContrastRatio(mountain.rgb, PALAEO_DARK_INK);
    report[band.id] = { land: land.rgb, landSamples: land.count, mountain: mountain.rgb,
      mountainSamples: mountain.count, separation: Number(separation.toFixed(1)),
      hueDegrees: Number(hue.toFixed(1)), inkContrast: Number(contrast.toFixed(2)) };
    return { band, land, mountain, separation, hue, contrast };
  });
  console.log(`palaeo tone census: ${JSON.stringify(report)}`);
  for (const row of rows) {
    const { band, land, mountain } = row;
    expect(land, `no palaeo-land pixels in the ${band.id} band`).toBeDefined();
    expect(mountain, `no palaeo-mountain pixels in the ${band.id} band`).toBeDefined();
    expect(land!.count, `${band.id}: too few palaeo-land samples`).toBeGreaterThanOrEqual(10);
    expect(mountain!.count, `${band.id}: too few palaeo-mountain samples`).toBeGreaterThanOrEqual(10);
    expect(row.separation,
      `${band.id}: mountain ${mountain!.rgb} vs land ${land!.rgb} luma-matched separation`)
      .toBeGreaterThanOrEqual(30);
    expect(row.hue, `${band.id}: mountain hue must stay a reddish brown, not a red`)
      .toBeGreaterThanOrEqual(10);
    expect(row.hue, `${band.id}: mountain hue must stay a reddish brown, not an orange`)
      .toBeLessThanOrEqual(30);
    // The predicted tone, channel by channel. This is the assertion that would
    // catch the class drifting back toward a light tan, which neither the
    // separation floor nor the hue window can see on their own.
    for (const [channel, name] of (["red", "green", "blue"] as const).entries()) {
      expect(mountain!.rgb[channel],
        `${band.id}: mountain ${name} against the predicted ${band.predicted.join(",")}`)
        .toBeGreaterThanOrEqual(band.predicted[channel]! - PALAEO_TONE_PREDICTION_TOLERANCE);
      expect(mountain!.rgb[channel],
        `${band.id}: mountain ${name} against the predicted ${band.predicted.join(",")}`)
        .toBeLessThanOrEqual(band.predicted[channel]! + PALAEO_TONE_PREDICTION_TOLERANCE);
    }
    // The dark ink has to stay legible over mountain ground at full light and at
    // mid lighting. Near the terminator a tone this dark cannot reach 3:1
    // against ink this dark - it is predicted at 2.21:1 - and the floor there is
    // 2: the band is held readable by its luma (predicted 82/255), not by the
    // ratio. A lighter class would clear 3:1 everywhere, which is exactly the
    // light tan this colour replaced.
    expect(row.contrast, `${band.id}: mountain against the dark outline ink`)
      .toBeGreaterThanOrEqual(band.minInkContrast);
  }
});

// `at=<lon>,<lat>` is a present-day coordinate. A link that framed it as a
// direction in the rendered frame would show whatever ground the plate model
// had rotated under that direction, silently, and the viewer could not tell.
test("poses an at= deep link onto the ground it names", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=90&at=-100,45&layers=borders,guides,palaeoCoastlines");
  await waitForCao(page);
  await expect.poll(() => globe(page).getAttribute("data-cao-palaeo-coastline-mode"),
    { timeout: 30_000 }).toBe("on");
  const stage = page.locator(".globe-stage");
  await expect(stage).toHaveAttribute("data-focus-resolution", "posed");
  // The ground this link names, at this age: the Western Interior Seaway.
  expect(await probeClass(page, -100, 45)).toBe("palaeo-shallow-marine");

  const centre = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[aria-label='Interactive three-dimensional Earth']");
    return [Number(canvas?.dataset.cameraLongitude), Number(canvas?.dataset.cameraLatitude)] as const;
  });
  // The camera blend and the once-a-second diagnostics publication both settle
  // before the aim can be read as a result.
  await expect.poll(async () => {
    const first = await centre();
    await page.waitForTimeout(1200);
    const second = await centre();
    return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) < 0.05;
  }, { timeout: 30_000 }).toBe(true);
  const aimed = await centre();
  // North America at 90 Ma is nowhere near its present-day longitude, so an
  // unposed aim would differ from this one by degrees.
  expect(Math.abs(aimed[0] + 100), `camera longitude ${aimed[0]}`).toBeGreaterThan(3);

  // The hash keeps naming the ground, not the place the ground had rotated to.
  expect(decodeURIComponent(await page.evaluate(() => window.location.hash)))
    .toContain("at=-100,45");

  // The pick path is the independent answer: it reports the picked ground's
  // own present-day direction, so a centre pick must return the coordinate the
  // link asked for. The first click releases the held focus; the second picks.
  // Playwright clicks the element's own centre, which is the pixel the camera
  // aim projects to; a viewport-centre offset would sample neighbouring ground.
  await globe(page).click();
  await globe(page).click();
  await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
    .toContain("material=");
  const picked = await page.evaluate(() => {
    const material = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("material");
    const address = JSON.parse(material ?? "{}") as
      { localCoordinate?: { directionAtReference?: [number, number, number] } };
    const direction = address.localCoordinate?.directionAtReference;
    if (!direction) return null;
    return [Math.atan2(direction[1], direction[0]) * 180 / Math.PI,
      Math.asin(Math.max(-1, Math.min(1, direction[2]))) * 180 / Math.PI] as const;
  });
  expect(picked, "centre pick carries a present-day direction").not.toBeNull();
  const [pickedLongitude, pickedLatitude] = picked!;
  // Compared as an angle on the sphere: a degree of longitude is not a degree
  // of ground at 45 degrees north.
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const separationDegrees = Math.acos(Math.min(1,
    Math.sin(radians(pickedLatitude)) * Math.sin(radians(45))
    + Math.cos(radians(pickedLatitude)) * Math.cos(radians(45))
      * Math.cos(radians(pickedLongitude + 100)))) * 180 / Math.PI;
  expect(separationDegrees,
    `centre pick present-day (${pickedLongitude}, ${pickedLatitude})`).toBeLessThan(5);
});

test("anchors the North Sea rift point of interest from the hash", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The resting pose at the same age, so the comparison isolates the focus and
  // not the age. 255 Ma lies inside the POI's declared 270-130 Ma interval and
  // inside the Cao fragment validity its anchor chart was cut to.
  await page.goto("./#age=255");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "none");
  const restingLongitude = Number(await globe(page).getAttribute("data-camera-longitude"));
  const restingLatitude = Number(await globe(page).getAttribute("data-camera-latitude"));
  expect(Number.isFinite(restingLongitude) && Number.isFinite(restingLatitude)).toBe(true);

  await page.goto("./#age=255&focus=north-sea-rift");
  // A fragment-only navigation is a same-document navigation: the document is
  // not reloaded and the app reads its deep link exactly once, at load. Reload
  // so the link is parsed the way a pasted link is, as a fresh visit.
  await page.reload();
  await waitForCao(page);
  await expect.poll(async () => globe(page).getAttribute("data-focus-kind"), { timeout: 20_000 })
    .not.toBe("none");
  await expect.poll(async () => {
    const longitude = Number(await globe(page).getAttribute("data-camera-longitude"));
    const latitude = Number(await globe(page).getAttribute("data-camera-latitude"));
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return 0;
    return Math.hypot(longitude - restingLongitude, latitude - restingLatitude);
  }, { timeout: 20_000 }).toBeGreaterThan(2);
});
