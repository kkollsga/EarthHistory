import { expect, test, type Page } from "@playwright/test";
import type { EarthHistorySurfaceProbe } from "../../src/render/GlobeScene";

declare global {
  interface Window {
    /** The scene's CPU coverage path, exposed for these probes only. */
    __earthHistorySurfaceProbe?: EarthHistorySurfaceProbe;
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

test("keeps layers usable and labels unavailable seafloor data", async ({ page }) => {
  await page.goto("./");
  await waitForCao(page);
  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const guides = page.getByRole("button", { name: /^Reference guides/ });
  await guides.click();
  await expect(globe(page)).toHaveAttribute("data-reference-guide-visible", "false");
  await expect(page.getByRole("button", { name: /Seafloor unavailable/ })).toBeDisabled();
  await expect(page.getByText(/no qualified ocean-floor age or depth field/i)).toBeVisible();
});

test("offers the palaeo-coastline layer control and leaves it off by default", async ({ page }) => {
  // Default off: the outline keeps its single dark ink, nothing palaeo is
  // fetched, and the control is available because the Cao 2017 charts now ship.
  const palaeoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("palaeo-coastlines/")) palaeoRequests.push(request.url());
  });
  await page.goto("./");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-interval-id", "");
  await expect(globe(page)).toHaveAttribute("data-cao-outline-tone-light-segments", "0");
  const darkSegments = Number(await globe(page)
    .getAttribute("data-cao-outline-tone-dark-segments"));
  expect(darkSegments).toBeGreaterThan(10_000);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const palaeo = page.getByRole("button", { name: /^Palaeo-coastlines \(Cao 2017\)/ });
  await expect(palaeo).toBeEnabled();
  await expect(palaeo).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/steps between 24 published map intervals/)).toBeVisible();
  await expect(page.getByText(/Cao 2017 map charts are not in this build/)).toHaveCount(0);
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
  const palaeo = page.getByRole("button", { name: /^Palaeo-coastlines \(Cao 2017\)/ });
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
  await expect(page.getByText("Coastline map interval: 94\u201381 Ma (Cao et al. 2017)")).toBeVisible();
  await expect(page.getByText(/minimum land \/ maximum flooding recorded anywhere in that bin/)).toBeVisible();
  await expect(page.getByText(/Cao 2024 continental crust, depth unmapped/)).toBeVisible();
  await expect(page.getByText(/Light grey outline · over shallow or deep sea/)).toBeVisible();
  await expect(page.getByText(/Outline tone is a legibility device, not evidence/)).toBeVisible();
  await expect(page.getByTestId("timeline-interval-marks").locator(".interval-mark"))
    .toHaveCount(24);

  // Only the classes this build publishes get a swatch. The mountain class is
  // compiled and validated offline but deferred out of the budget, so a row for
  // it would name evidence no interval carries.
  await expect(page.getByText("Palaeo land", { exact: true })).toBeVisible();
  await expect(page.getByText("Palaeo shallow sea", { exact: true })).toBeVisible();
  await expect(page.getByText("Palaeo mountain", { exact: true })).toHaveCount(0);

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
  await page.getByRole("button", { name: /^Palaeo-coastlines \(Cao 2017\)/ }).click();
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
