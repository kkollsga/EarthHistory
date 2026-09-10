import { expect, test, type Page } from "@playwright/test";

const canvas = (page: Page) => page.locator("canvas[aria-label='Interactive three-dimensional Earth']");

async function waitForSurface(page: Page) {
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => canvas(page).getAttribute("data-surface-status")).toBe("ready");
  await expect.poll(async () => {
    const target = canvas(page);
    const [status, requestedKey, displayedKey] = await Promise.all([
      target.getAttribute("data-cube-status"),
      target.getAttribute("data-cube-requested-key"),
      target.getAttribute("data-cube-displayed-key"),
    ]);
    return status === "ready" && requestedKey !== null && requestedKey === displayedKey;
  }).toBe(true);
}

async function waitForRefinedCube(page: Page, source: RegExp) {
  await expect.poll(async () => {
    const target = canvas(page);
    const [status, refinement, requestedKey, displayedKey, requestedAt, completeAt, delta, byLod] =
      await Promise.all([
        target.getAttribute("data-cube-status"),
        target.getAttribute("data-cube-refinement-status"),
        target.getAttribute("data-cube-requested-key"),
        target.getAttribute("data-cube-displayed-key"),
        target.getAttribute("data-cube-target-lod-requested-at"),
        target.getAttribute("data-cube-target-lod-complete-at"),
        target.getAttribute("data-cube-max-neighbor-level-delta"),
        target.getAttribute("data-cube-visible-by-lod"),
      ]);
    const lod = byLod === null ? {} : JSON.parse(byLod) as Record<string, number>;
    const refinedTiles = Object.entries(lod)
      .filter(([level]) => Number(level) > 0)
      .reduce((total, [, count]) => total + count, 0);
    return status === "ready" && refinement === "ready" &&
      requestedKey !== null && requestedKey === displayedKey && source.test(displayedKey) &&
      Number(completeAt) > Number(requestedAt) && Number(delta) <= 1 && refinedTiles > 0;
  }, { timeout: 10_000 }).toBe(true);
}

async function waitForCubeNativeModernPatch(
  page: Page,
  id: string,
  mode: "surface" | "seafloor",
) {
  await waitForRefinedCube(
    page,
    new RegExp(`:${mode}:regional:ETOPO_2022_v1_60s_surface:${id}$`),
  );
  const target = canvas(page);
  await expect(target).toHaveAttribute("data-regional-strategy", "cube-native");
  await expect(target).toHaveAttribute("data-regional-visible", "false");
  await expect(target).toHaveAttribute("data-regional-source", id);
  await expect.poll(async () => {
    const [status, appliedKey, displayedKey] = await Promise.all([
      target.getAttribute("data-regional-status"),
      target.getAttribute("data-regional-applied-key"),
      target.getAttribute("data-cube-displayed-key"),
    ]);
    return status === "ready" && appliedKey !== null && appliedKey === displayedKey;
  }).toBe(true);
  await expect.poll(async () =>
    (await target.getAttribute("data-cube-source-patch-ids"))?.split(",").includes(id),
  ).toBe(true);
  await expect.poll(async () => {
    const tiles = Number(await target.getAttribute("data-cube-source-material-tiles"));
    const bytes = Number(await target.getAttribute("data-cube-source-material-texture-bytes"));
    // Each source tile owns three RGBA8 textures with a 128px density target,
    // one canonical endpoint row/column, and two gutter texels. More visible
    // source tiles may use more memory as the LOD allocator spends its existing
    // budget; the total cache remains the product-level bound below.
    return tiles > 0 && bytes > 0 && bytes <= tiles * 3 * 131 * 131 * 4;
  }).toBe(true);
  await expect.poll(async () => Number(await target.getAttribute("data-cube-cache-bytes")))
    .toBeLessThanOrEqual(48 * 1024 * 1024);
  await expect(target).toHaveAttribute("data-cube-lod-max-level", "4");
  await expect(target).toHaveAttribute("data-cube-lod-max-leaves", "96");
}

async function waitForExactModernNativePublication(
  page: Page,
  detail: "coarse" | "regional",
) {
  const target = canvas(page);
  await expect.poll(() => target.getAttribute("data-temporal-status")).toBe("ready");
  await expect(target).toHaveAttribute("data-temporal-displayed-age-ma", "0.000000");
  await expect(target).toHaveAttribute(
    "data-temporal-material-detail-method",
    "exact-modern-native-cube-fields",
  );
  await expect(target).toHaveAttribute("data-temporal-material-detail-profile", detail);
  await expect(target).toHaveAttribute("data-temporal-update-vertices", "0");
  await expect.poll(async () =>
    Number(await target.getAttribute("data-temporal-native-reused-vertices")),
  ).toBeGreaterThan(0);
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
}

async function publishedMeshOverlayKey(page: Page) {
  const target = canvas(page);
  const [
    status,
    surfaceKey,
    appliedKey,
    cubeKey,
    temporalStatus,
    displayedAge,
    mode,
    exaggeration,
    materialDetail,
  ] =
    await Promise.all([
    target.getAttribute("data-overlay-drape-status"),
    target.getAttribute("data-overlay-drape-surface-key"),
    target.getAttribute("data-overlay-drape-applied-surface-key"),
    target.getAttribute("data-cube-displayed-key"),
    target.getAttribute("data-temporal-status"),
    target.getAttribute("data-temporal-displayed-age-ma"),
    target.getAttribute("data-surface-mode"),
    target.getAttribute("data-vertical-exaggeration"),
    target.getAttribute("data-temporal-material-detail-profile"),
  ]);
  if (status !== "ready" || surfaceKey === null || surfaceKey !== appliedKey || cubeKey === null ||
      mode === null || exaggeration === null) return null;
  if (surfaceKey.startsWith(cubeKey) && /^:mesh:r[1-9]\d*$/.test(surfaceKey.slice(cubeKey.length))) {
    return surfaceKey;
  }
  const interval = cubeKey.match(/__(paleodem-[^:]+):/)?.[1];
  if (
    temporalStatus !== "ready" || interval === undefined || displayedAge === null ||
    (materialDetail !== "coarse" && materialDetail !== "regional")
  ) return null;
  const expectedPrefix = [
    interval,
    displayedAge,
    mode,
    Number(exaggeration).toFixed(3),
    materialDetail,
    "published:r",
  ].join(":");
  return surfaceKey.startsWith(expectedPrefix) && /^\d+$/.test(surfaceKey.slice(expectedPrefix.length))
    ? surfaceKey
    : null;
}

async function selectChapter(page: Page, id: string, heading: string) {
  await page.locator("#chapter-jump").selectOption(id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  await expect(page.locator("#chapter-jump")).toHaveValue(id);
  await waitForSurface(page);
}

async function openMenu(page: Page) {
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await menuButton.click();
  await expect(page.getByRole("menu", { name: "Explore tools" })).toBeVisible();
}

async function useHighDetail(page: Page) {
  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Rendering quality/ }).click();
  await page.getByRole("button", { name: "High detail" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await expect.poll(() => canvas(page).getAttribute("data-quality")).toBe("high");
}

async function canvasPosition(page: Page, xRatio = 0.5, yRatio = 0.5) {
  const bounds = await canvas(page).boundingBox();
  expect(bounds).not.toBeNull();
  return {
    x: bounds!.x + bounds!.width * xRatio,
    y: bounds!.y + bounds!.height * yRatio,
  };
}

test("loads the Pages subpath with local assets and a complete chapter picker", { tag: "@ci" }, async ({ page, baseURL }) => {
  const externalRequests = new Set<string>();
  const failedResponses: string[] = [];
  const localOrigin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== localOrigin) externalRequests.add(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("./");
  await waitForSurface(page);

  await expect(page).toHaveTitle("Earth History");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.locator(".view-evidence")).toHaveText(/Rendered viewModel output/);
  await expect(page.locator(".chapter-reference a")).toHaveAttribute("href", /^https:/);
  await expect(page.locator("#chapter-jump option")).toHaveCount(37);
  expect(externalRequests).toEqual(new Set());
  expect(failedResponses).toEqual([]);
});

test("supports the explicit WebGL 2 fallback", { tag: "@ci" }, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./?renderer=webgl2");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-renderer-backend", "webgl2");
  expect(errors).toEqual([]);
});

test("creates and toggles bounded schematic reference guides", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  await useHighDetail(page);
  await waitForRefinedCube(
    page,
    /:surface:coarse:ETOPO_2022_v1_60s_surface:mid-atlantic-ridge$/,
  );
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  const target = canvas(page);
  await expect(target).toHaveAttribute("data-country-ribbon-batches", "1");
  await expect(target).toHaveAttribute("data-reference-guide-visible", "true");
  await expect(target).toHaveAttribute("data-reference-guide-batches", "1");
  await expect(page.locator(".surface-legend")).toContainText(/schematic climate guides/i);
  const created = await target.evaluate((element) => ({
    bytes: element.dataset.referenceGuideBytes,
    vertices: element.dataset.referenceGuideVertices,
  }));
  expect(Number(created.bytes)).toBeGreaterThan(0);
  expect(Number(created.vertices)).toBeGreaterThan(0);
  expect(Number(created.bytes)).toBeLessThanOrEqual(2 * 1024 * 1024);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const guides = page.getByRole("button", { name: /^Reference guides/ });
  await expect(guides).toHaveAttribute("aria-pressed", "true");
  await guides.click();
  await expect(guides).toHaveAttribute("aria-pressed", "false");
  await expect(target).toHaveAttribute("data-reference-guide-visible", "false");
  await expect(target).toHaveAttribute("data-reference-guide-bytes", created.bytes!);
  await expect(target).toHaveAttribute("data-reference-guide-vertices", created.vertices!);
  await guides.click();
  await expect(guides).toHaveAttribute("aria-pressed", "true");
  await expect(target).toHaveAttribute("data-reference-guide-visible", "true");
  await expect(target).toHaveAttribute("data-reference-guide-bytes", created.bytes!);
  await expect(target).toHaveAttribute("data-reference-guide-vertices", created.vertices!);
  const restored = await target.evaluate((element) => ({
    bytes: Number(element.dataset.referenceGuideBytes),
    vertices: Number(element.dataset.referenceGuideVertices),
  }));
  expect(restored.bytes).toBeGreaterThan(0);
  expect(restored.vertices).toBeGreaterThan(0);
  expect(restored.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

test("keeps story age, title, and geographic source age distinct", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);

  await selectChapter(page, "quaternary-lgm", "Last Glacial Maximum");
  await expect(page.locator(".age-display")).toHaveText("21 ka");
  await expect(page.locator(".geography-age")).toContainText("Today–5 Ma");

  await selectChapter(page, "permian", "Permian");
  await expect(page.locator(".age-display")).toHaveText("255 Ma");
  await expect(page.locator(".geography-age")).toContainText("255 Ma");

  await selectChapter(page, "kpg-boundary", "K–Pg boundary");
  await expect(page.locator(".age-display")).toHaveText("66.04 Ma");
  await expect(page.locator(".geography-age")).toContainText("65 Ma–70 Ma");

  await selectChapter(page, "antarctic-glaciation", "Antarctic glaciation");
  await expect(page.locator(".age-display")).toHaveText("33.6 Ma");
  await expect(page.locator(".geography-age")).toContainText("30 Ma–35 Ma");

  const sourceAges = page.locator("#source-age-jump");
  await expect(sourceAges.locator("option:not([disabled])")).toHaveCount(109);
  await sourceAges.selectOption("385");
  await waitForSurface(page);
  await expect(page.locator(".age-display")).toHaveText("385 Ma");
  await expect(page.locator(".geography-age")).toContainText("385 Ma");

  await selectChapter(page, "moon-forming-scenario", "Moon-forming impact scenario");
  await expect(page.locator(".scenario-label")).toHaveText("Illustrative scene · geography unresolved");
  await expect(page.locator(".geography-age")).toContainText("Illustrative field");
});

test("keeps exposed seafloor available across historical source ages and reload", async ({ page }) => {
  await page.goto("./#age=100&layers=borders,guides&relief=8");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-surface-mode", "surface");

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const seafloor = page.getByRole("button", { name: /^Expose seafloor/ });
  await expect(seafloor).toHaveAttribute("aria-pressed", "false");
  await seafloor.click();
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-surface-mode", "seafloor");
  await expect(page.locator(".surface-legend")).toContainText("Exposed seafloor");
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("view")).toBe("seafloor");

  await page.locator("#source-age-jump").selectOption("105");
  await waitForSurface(page);
  await expect(page.locator(".age-display")).toHaveText("105 Ma");
  await expect(canvas(page)).toHaveAttribute("data-surface-mode", "seafloor");
  await page.reload();
  await waitForSurface(page);
  await expect(page.locator(".age-display")).toHaveText("105 Ma");
  await expect(canvas(page)).toHaveAttribute("data-surface-mode", "seafloor");
});

test("changes relief, keeps clouds off by default, and restores an orbital camera", async ({ page }) => {
  test.slow();
  await page.goto("./#age=22.5&layers=borders,guides&relief=8");
  await waitForSurface(page);
  await useHighDetail(page);
  await waitForSurface(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-displayed-age-ma")))
    .toBeCloseTo(22.5, 3);
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  await expect(canvas(page)).toHaveAttribute("data-detail", "coarse");
  await expect(canvas(page)).toHaveAttribute("data-temporal-material-detail-profile", "coarse");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-level", "4");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-leaves", "96");
  const preScrubSurfaceKey = await publishedMeshOverlayKey(page);
  expect(preScrubSurfaceKey).not.toBeNull();
  await expect(page.locator(".surface-legend")).toContainText("8×");

  await page.evaluate(() => {
    const target = document.querySelector("canvas");
    const state = window as Window & { __temporalLodPolicies?: string[] };
    state.__temporalLodPolicies = [];
    if (!target) return;
    const record = () => state.__temporalLodPolicies!.push(
      `${target.dataset.cubeLodMaxLevel}/${target.dataset.cubeLodMaxLeaves}`,
    );
    new MutationObserver(record).observe(target, {
      attributes: true,
      attributeFilter: ["data-cube-lod-max-level", "data-cube-lod-max-leaves"],
    });
  });
  await page.locator("#geological-age").fill("44");
  const scrubbedAgeMa = 44 / 1000 * 538.8;
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-requested-age-ma")))
    .toBeCloseTo(scrubbedAgeMa, 3);
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  expect(await page.evaluate(() =>
    (window as Window & { __temporalLodPolicies?: string[] }).__temporalLodPolicies ?? [],
  )).toContain("0/6");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-level", "4");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-leaves", "96");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  const initialSurfaceKey = await publishedMeshOverlayKey(page);
  expect(initialSurfaceKey).not.toBeNull();
  expect(initialSurfaceKey).not.toBe(preScrubSurfaceKey);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  const relief = page.getByRole("slider", { name: /^Terrain relief/ });
  await relief.fill("30");
  await expect(page.locator(".surface-legend")).toContainText("30×");
  await expect.poll(() => canvas(page).getAttribute("data-vertical-exaggeration")).toBe("30.0");
  await expect(canvas(page)).toHaveAttribute("data-cube-relief-update", "atomic-temporal-restage");
  await expect(canvas(page)).toHaveAttribute("data-overlay-drape-status", "ready");
  await expect(canvas(page)).toHaveAttribute("data-overlay-drape-exaggeration", "30.0");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-overlay-drape-vertices")))
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-overlay-drape-cache-bytes")))
    .toBeLessThanOrEqual(16 * 1024 * 1024);
  await expect.poll(async () => {
    const surfaceKey = await publishedMeshOverlayKey(page);
    return surfaceKey !== null && surfaceKey !== initialSurfaceKey;
  }).toBe(true);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-displayed-age-ma")))
    .toBeCloseTo(scrubbedAgeMa, 3);
  const reliefSurfaceKey = await publishedMeshOverlayKey(page);
  expect(reliefSurfaceKey).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const bounds = await canvas(page).boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  for (let index = 0; index < 12; index++) await page.mouse.wheel(0, -300);
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await waitForRefinedCube(page, /:surface:regional:/);
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect(canvas(page)).toHaveAttribute("data-temporal-material-detail-profile", "regional");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-level", "4");
  await expect(canvas(page)).toHaveAttribute("data-cube-lod-max-leaves", "96");
  await expect.poll(async () => {
    const byLod = JSON.parse(
      await canvas(page).getAttribute("data-cube-visible-by-lod") ?? "{}",
    ) as Record<string, number>;
    return Object.entries(byLod).some(([level, count]) => Number(level) > 1 && count > 0);
  }).toBe(true);
  await expect.poll(async () => {
    const surfaceKey = await publishedMeshOverlayKey(page);
    return surfaceKey !== null && surfaceKey !== reliefSurfaceKey;
  }).toBe(true);

  await page.locator("#source-age-jump").selectOption("25");
  await waitForSurface(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-displayed-age-ma")))
    .toBeCloseTo(25, 3);
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect(canvas(page)).toHaveAttribute("data-detail", "regional");
  await expect(canvas(page)).toHaveAttribute("data-temporal-material-detail-profile", "regional");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Reset camera" }).click();
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("coarse");
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect(canvas(page)).toHaveAttribute("data-temporal-material-detail-profile", "coarse");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
});

test("opens repeatable modern landscape views and marks the seafloor explicitly", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  await useHighDetail(page);
  const landscapes = page.getByLabel("Explore a landscape");
  await expect(landscapes.locator("option")).toHaveCount(14);

  await landscapes.selectOption("mid-atlantic-ridge");
  await expect(page.locator(".landscape-summary")).toContainText("submerged divergent plate boundary");
  await expect(page.locator(".surface-legend")).toContainText("Exposed seafloor");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("seafloor");
  await waitForSurface(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")), {
    timeout: 3_000,
  }).toBeLessThan(1.82);
  await waitForRefinedCube(page, /:seafloor:regional:ETOPO_2022_v1_60s_surface:mid-atlantic-ridge$/);
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  await expect(page).toHaveURL(/place=mid-atlantic-ridge/);
  await page.reload();
  await waitForSurface(page);
  await useHighDetail(page);
  await expect(page.getByLabel("Explore a landscape")).toHaveValue("mid-atlantic-ridge");
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance"))).toBeLessThan(1.82);
  await waitForRefinedCube(page, /:seafloor:regional:ETOPO_2022_v1_60s_surface:mid-atlantic-ridge$/);
  await expect.poll(() => canvas(page).getAttribute("data-temporal-status")).toBe("ready");
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");

  await landscapes.selectOption("alps");
  await expect(page.locator(".surface-legend")).toContainText("Surface water");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("surface");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(1.18, 2);
  await waitForCubeNativeModernPatch(page, "alps", "surface");
  await waitForExactModernNativePublication(page, "regional");
  const nativeSurfaceKey = await publishedMeshOverlayKey(page);
  expect(nativeSurfaceKey).not.toBeNull();

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await page.getByRole("slider", { name: /^Terrain relief/ }).fill("30");
  await expect.poll(() => canvas(page).getAttribute("data-vertical-exaggeration")).toBe("30.0");
  await waitForExactModernNativePublication(page, "regional");
  await expect.poll(async () => {
    const key = await publishedMeshOverlayKey(page);
    return key !== null && key !== nativeSurfaceKey;
  }).toBe(true);
  await page.keyboard.press("Escape");

  // The ETOPO patch is valid only at 0 Ma. A fractional request must leave its
  // source context, and returning to the endpoint must restore it exactly.
  await page.locator("#geological-age").fill("969");
  await expect.poll(async () =>
    Number(await canvas(page).getAttribute("data-temporal-requested-age-ma")),
  ).toBeCloseTo(2.5, 2);
  await expect.poll(async () =>
    Number(await canvas(page).getAttribute("data-temporal-displayed-age-ma")),
  ).toBeCloseTo(2.5, 2);
  await expect.poll(async () =>
    Number(await canvas(page).getAttribute("data-temporal-update-vertices")),
  ).toBeGreaterThan(0);
  await expect.poll(() => publishedMeshOverlayKey(page)).not.toBeNull();
  await expect(canvas(page)).toHaveAttribute("data-cube-source-patch-ids", "none");
  await page.locator("#geological-age").fill("0");
  await waitForExactModernNativePublication(page, "regional");
  await waitForCubeNativeModernPatch(page, "alps", "surface");

  await landscapes.selectOption("japan-trench");
  await expect(page.locator(".surface-legend")).toContainText("Surface water");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("surface");
  await waitForCubeNativeModernPatch(page, "japan-trench", "surface");
  const [displayedMinimum, sourceMinimum] = await Promise.all([
    canvas(page).getAttribute("data-cube-displayed-height-range-metres"),
    canvas(page).getAttribute("data-cube-source-material-height-range-metres"),
  ]).then(([displayed, source]) => [
    Number(displayed?.split(",")[0]),
    Number(source?.split(",")[0]),
  ]);
  expect(displayedMinimum).toBeGreaterThanOrEqual(0);
  expect(sourceMinimum).toBeLessThan(0);

  await landscapes.selectOption("sahara-sahel");
  await expect(page.locator(".landscape-summary")).toContainText("semi-arid steppe and savanna");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("surface");
  await page.locator("#chapter-jump").selectOption("cretaceous");
  await expect(page.getByLabel("Explore a landscape")).toHaveCount(0);
  await expect(page).not.toHaveURL(/place=/);
});

test("offers one labelled timeline range control with keyboard scrubbing", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  const timelineRange = page.getByLabel("Timeline range");
  const slider = page.getByRole("slider", { name: /^Geological age/ });
  await expect(timelineRange).toHaveValue("recent");
  await expect(page.locator(".chapter-marks button, .timeline-chapters button")).toHaveCount(0);

  await timelineRange.selectOption("phanerozoic");
  await expect(timelineRange).toHaveValue("phanerozoic");
  await expect(page.locator(".period-band")).toContainText("Cretaceous");

  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.locator(".timeline-handle-label")).not.toHaveText("Today");
  await expect(page.locator(".timeline-readout")).toContainText("Geography source: Today–5 Ma");

  await page.locator("#chapter-jump").selectOption("moon-forming-scenario");
  await expect(timelineRange).toHaveValue("deep");
  await expect(page.locator(".geological-bands")).toContainText("Hadean");
  await timelineRange.selectOption("phanerozoic");
  await expect(timelineRange).toHaveValue("phanerozoic");
  await expect(page.locator(".age-display")).toHaveText("538.8 Ma");

  await page.locator("#chapter-jump").selectOption("present");
  await page.getByRole("button", { name: "Travel through time" }).click();
  await expect(page.getByRole("button", { name: "Pause time travel" })).toBeVisible();
  await expect(page.locator(".age-display")).toHaveText("4.567 Ga");
  await page.getByRole("button", { name: "Pause time travel" }).click();
});

test("keeps one continuous requested age across terrain, countries, and a tagged focus", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=22.5&layers=borders,guides&focus=east-african-rift&relief=8");
  await waitForSurface(page);
  const target = canvas(page);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-requested-age-ma")))
    .toBeCloseTo(22.5, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(22.5, 3);
  await expect(target).toHaveAttribute("data-focus-kind", "poi");

  const center = await canvasPosition(page);
  await page.mouse.move(center.x, center.y);
  for (let index = 0; index < 5; index++) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await target.getAttribute("data-camera-distance")))
    .toBeLessThan(1.65);
  const taggedDistance = Number(await target.getAttribute("data-camera-distance"));
  const initialLongitude = Number(await target.getAttribute("data-camera-longitude"));

  const sliderValues = [43, 44, 45, 46, 47, 48, 49, 50, 51];
  const ageSlider = page.locator("#geological-age");
  for (const value of sliderValues) {
    await ageSlider.fill(String(value));
    await page.waitForTimeout(35);
  }
  const expectedAgeMa = sliderValues.at(-1)! / 1000 * 538.8;

  await expect(page.locator(".age-display")).toHaveText("27.48 Ma");
  await expect(page.locator(".geography-age")).toContainText("25 Ma–30 Ma · interpolated");
  await expect(page.locator(".timeline-readout")).toContainText("Geography source: 25 Ma–30 Ma · interpolated");
  await expect(page.locator("#source-age-jump option:not([disabled])")).toHaveCount(109);
  await expect.poll(() => target.getAttribute("data-temporal-status")).toBe("ready");
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-requested-age-ma")))
    .toBeCloseTo(expectedAgeMa, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-displayed-age-ma")))
    .toBeCloseTo(expectedAgeMa, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-update-vertices")))
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-requested-age-ma")))
    .toBeCloseTo(expectedAgeMa, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(expectedAgeMa, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-resolved-parts")))
    .toBeGreaterThan(100);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-poi-displayed-age-ma")))
    .toBeCloseTo(expectedAgeMa, 3);
  await expect(target).toHaveAttribute("data-focus-kind", "poi");
  await expect(page).toHaveURL(/(?:#|&)focus=east-african-rift(?:&|$)/);
  await expect.poll(async () => Number(await target.getAttribute("data-camera-distance")))
    .toBeCloseTo(taggedDistance, 2);
  await expect.poll(async () =>
    Math.abs(Number(await target.getAttribute("data-camera-longitude")) - initialLongitude),
  ).toBeGreaterThan(0.01);
});

test("discloses native source fallback when plate motion cannot load", async ({ page }) => {
  await page.route("**/data/paleomap-motion-v1.json", (route) => route.abort("failed"));
  await page.goto("./#age=22.5&layers=borders,guides&relief=8");
  await waitForSurface(page);

  await expect(page.locator(".surface-legend [role='status']"))
    .toContainText("Plate motion unavailable");
  await expect(page.locator(".geography-age")).toContainText("25 Ma · plate motion unavailable");
  await expect(page.locator(".timeline-readout")).toContainText("Geography source: 25 Ma");
  await expect(page.locator(".view-evidence")).toHaveText(/Rendered viewModel output/);
  await expect(canvas(page)).not.toHaveAttribute("data-temporal-status", "ready");
});

test("keeps Cao terrain, boundaries, countries, and a tagged focus on one continuous age", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#age=20&layers=borders,guides&focus=east-african-rift&relief=8");
  await waitForSurface(page);
  const target = canvas(page);
  const center = await canvasPosition(page);
  await page.mouse.move(center.x, center.y);
  for (let index = 0; index < 5; index++) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await target.getAttribute("data-camera-distance"))).toBeLessThan(1.65);
  const taggedDistance = Number(await target.getAttribute("data-camera-distance"));
  const initialLongitude = Number(await target.getAttribute("data-camera-longitude"));

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await page.getByRole("button", { name: /^Cao plate coordinates/ }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page).toHaveURL(/(?:#|&)coordinates=cao(?:&|$)/);
  await expect(target).toHaveAttribute("data-period-coordinate-view", "cao-2024-v2.4");
  await expect(page.locator(".view-evidence")).toHaveText(/Rendered viewSynthesis/);
  await expect.poll(() => target.getAttribute("data-period-coordinate-status"), { timeout: 20_000 }).toBe("ready");
  await expect.poll(async () => Number(await target.getAttribute("data-period-coordinate-displayed-age-ma")))
    .toBeCloseTo(20, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-cao-boundary-points"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await target.getAttribute("data-period-coordinate-unsupported-vertices")))
    .toBeGreaterThan(0);
  await expect(page.locator(".surface-legend")).toContainText("partial converted relief");
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(20, 3);
  const initialPoiPositionSignature = await target.getAttribute("data-temporal-poi-position-signature");
  expect(initialPoiPositionSignature).toBeTruthy();

  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const mismatches: Array<Record<string, string | undefined>> = [];
    const frameMismatches: Array<Record<string, string | undefined>> = [];
    const blankFrames: string[] = [];
    const state = window as Window & {
      __caoReadinessMismatches?: typeof mismatches;
      __caoFrameMismatches?: typeof frameMismatches;
      __caoBlankFrames?: typeof blankFrames;
      __sampleCaoFrames?: boolean;
    };
    state.__caoReadinessMismatches = mismatches;
    state.__caoFrameMismatches = frameMismatches;
    state.__caoBlankFrames = blankFrames;
    state.__sampleCaoFrames = true;
    if (!canvas) return;
    new MutationObserver(() => {
      if (canvas.dataset.periodCoordinateStatus !== "ready") return;
      const ages = {
        terrain: canvas.dataset.periodCoordinateDisplayedAgeMa,
        boundary: canvas.dataset.caoBoundaryDisplayedAgeMa,
        country: canvas.dataset.temporalCountryDisplayedAgeMa,
        poi: canvas.dataset.temporalPoiDisplayedAgeMa,
      };
      if (Object.values(ages).some((age) => age !== ages.terrain)) mismatches.push(ages);
    }).observe(canvas, { attributes: true });
    const sampleFrame = () => {
      if (!state.__sampleCaoFrames) return;
      const ages = {
        terrain: canvas.dataset.periodCoordinateDisplayedAgeMa,
        boundary: canvas.dataset.caoBoundaryDisplayedAgeMa,
        country: canvas.dataset.temporalCountryDisplayedAgeMa,
        poi: canvas.dataset.temporalPoiDisplayedAgeMa,
      };
      const values = Object.values(ages);
      if (values.every((age) => age !== undefined) && values.some((age) => age !== ages.terrain)) {
        frameMismatches.push(ages);
      }
      if (Number(canvas.dataset.surfaceVisibleMeshes) <= 0) {
        blankFrames.push(canvas.dataset.surfaceVisibleMeshes ?? "missing");
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });

  for (const value of [38, 39, 40, 41, 42]) {
    await page.locator("#geological-age").fill(String(value));
    await page.waitForTimeout(35);
  }
  const requestedAge = Number(await target.getAttribute("data-period-coordinate-requested-age-ma"));
  expect(requestedAge).toBeGreaterThan(20);
  expect(requestedAge).toBeLessThan(25);
  await expect.poll(() => target.getAttribute("data-period-coordinate-status"), { timeout: 20_000 }).toBe("ready");
  await expect.poll(async () => Number(await target.getAttribute("data-period-coordinate-displayed-age-ma")))
    .toBeCloseTo(requestedAge, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-cao-boundary-displayed-age-ma")))
    .toBeCloseTo(requestedAge, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-period-coordinate-resolved-vertices")))
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(requestedAge, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-poi-displayed-age-ma")))
    .toBeCloseTo(requestedAge, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-poi-displayed-count")))
    .toBeGreaterThan(0);
  await expect.poll(() => target.getAttribute("data-temporal-poi-position-signature"))
    .not.toBe(initialPoiPositionSignature);
  await expect(target).toHaveAttribute("data-focus-kind", "poi");
  await expect.poll(async () => Number(await target.getAttribute("data-camera-distance")))
    .toBeCloseTo(taggedDistance, 2);
  await expect.poll(async () => Math.abs(Number(await target.getAttribute("data-camera-longitude")) - initialLongitude))
    .toBeGreaterThan(0.01);

  await page.locator("#source-age-jump").selectOption("25");
  await expect.poll(() => target.getAttribute("data-period-coordinate-status"), { timeout: 20_000 }).toBe("ready");
  await expect.poll(async () => Number(await target.getAttribute("data-period-coordinate-displayed-age-ma")))
    .toBeCloseTo(25, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-cao-boundary-displayed-age-ma")))
    .toBeCloseTo(25, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(25, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-temporal-poi-displayed-age-ma")))
    .toBeCloseTo(25, 3);
  await expect.poll(async () => Number(await target.getAttribute("data-surface-visible-meshes")))
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await target.getAttribute("data-camera-distance")))
    .toBeCloseTo(taggedDistance, 2);
  expect(await page.evaluate(() =>
    (window as Window & { __caoReadinessMismatches?: unknown[] }).__caoReadinessMismatches ?? []
  )).toEqual([]);
  expect(await page.evaluate(() => {
    const state = window as Window & {
      __caoFrameMismatches?: unknown[];
      __caoBlankFrames?: string[];
      __sampleCaoFrames?: boolean;
    };
    state.__sampleCaoFrames = false;
    return state.__caoFrameMismatches ?? [];
  })).toEqual([]);
  expect(await page.evaluate(() =>
    (window as Window & { __caoBlankFrames?: string[] }).__caoBlankFrames ?? []
  )).toEqual([]);
});

test("falls back visibly when the Cao coordinate bundle cannot load", async ({ page }) => {
  await page.route("**/data/cao-ocean-motion-v1.json", (route) => route.abort("failed"));
  await page.goto("./#age=100&layers=borders,guides&relief=8");
  await waitForSurface(page);
  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await page.getByRole("button", { name: /^Cao plate coordinates/ }).click();
  await expect(page.locator(".surface-legend [role='status']"))
    .toContainText("Cao coordinates unavailable · PALEOMAP retained");
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("coordinates"))
    .toBeNull();
  await expect(canvas(page)).not.toHaveAttribute("data-period-coordinate-view", "cao-2024-v2.4");
});

test("crossfades completed authored scenes and settles rapid chapter changes on the latest request", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  await page.evaluate(() => {
    const target = document.querySelector("canvas");
    const transitions: string[] = [];
    (window as Window & { __surfaceTransitions?: string[] }).__surfaceTransitions = transitions;
    if (!target) return;
    new MutationObserver(() => transitions.push(target.dataset.surfaceTransition ?? "missing"))
      .observe(target, { attributes: true, attributeFilter: ["data-surface-transition"] });
  });

  await selectChapter(page, "cryogenian", "Cryogenian");
  await expect.poll(() => canvas(page).getAttribute("data-surface-transition")).toBe("idle");
  expect(await page.evaluate(() =>
    (window as Window & { __surfaceTransitions?: string[] }).__surfaceTransitions ?? [],
  )).toContain("crossfade");
  await page.evaluate(() => {
    const target = document.querySelector("canvas");
    const state = window as Window & {
      __surfaceTransitions?: string[];
      __mappedBlankFrames?: string[];
      __sampleMappedFrames?: boolean;
    };
    state.__surfaceTransitions = [];
    state.__mappedBlankFrames = [];
    state.__sampleMappedFrames = true;
    const sampleFrame = () => {
      if (!state.__sampleMappedFrames) return;
      if (Number(target?.dataset.surfaceVisibleMeshes) <= 0) {
        state.__mappedBlankFrames!.push(target?.dataset.surfaceVisibleMeshes ?? "missing");
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });

  await page.locator("#chapter-jump").selectOption("permian");
  await page.locator("#chapter-jump").selectOption("kpg-boundary");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("K–Pg boundary");
  await waitForSurface(page);
  await expect.poll(() => canvas(page).getAttribute("data-surface-transition")).toBe("idle");
  const transitions = await page.evaluate(() =>
    (window as Window & { __surfaceTransitions?: string[] }).__surfaceTransitions ?? [],
  );
  expect(transitions).not.toContain("crossfade");
  await expect(page.locator(".geography-age")).toContainText("65 Ma–70 Ma");
  await waitForRefinedCube(
    page,
    /^kpg-boundary__paleodem-65-70ma:surface:coarse:procedural$/,
  );
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-requested-age-ma")))
    .toBeCloseTo(66.04, 3);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-displayed-age-ma")))
    .toBeCloseTo(66.04, 3);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-country-displayed-age-ma")))
    .toBeCloseTo(66.04, 3);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-temporal-poi-displayed-age-ma")))
    .toBeCloseTo(66.04, 3);
  expect(await page.evaluate(() => {
    const state = window as Window & { __mappedBlankFrames?: string[]; __sampleMappedFrames?: boolean };
    state.__sampleMappedFrames = false;
    return state.__mappedBlankFrames ?? [];
  })).toEqual([]);
});

test("a stale retry cannot replace a newer chapter", async ({ page }) => {
  let attempts = 0;
  await page.route("**/data/paleodem-255ma.bin", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("failed");
    else {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    }
  });
  await page.goto("./");
  await waitForSurface(page);
  await page.locator("#chapter-jump").selectOption("permian");
  await expect(page.getByRole("alert")).toContainText("Reconstruction unavailable");
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator("#chapter-jump").selectOption("kpg-boundary");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("K–Pg boundary");
  await expect(page.locator(".geography-age")).toContainText("65 Ma–70 Ma");
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("K–Pg boundary");
  await expect(page.locator(".geography-age")).toContainText("65 Ma–70 Ma");
});

test("does not offer globe navigation for an unlocalized ancient evidence site", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  await selectChapter(page, "jack-hills-oceans", "Evidence for early water");
  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await page.getByRole("button", { name: /Jack Hills zircon and early water/ }).click();
  await expect(page.getByText("This note has no defensible map position in this chapter.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Locate on globe" })).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
});

test("shows only field notes valid at the requested age and clears an expired selection", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await expect(page.locator(".notes-list button")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toContainText("2 notes at Today");
  await expect(page.getByRole("button", { name: /Andean volcanic margin/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Chicxulub impact/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Andean volcanic margin/ }).click();
  await expect(page).toHaveURL(/(?:#|&)focus=andes-volcanic-margin(?:&|$)/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const taggedCenter = await canvasPosition(page);
  await page.mouse.move(taggedCenter.x, taggedCenter.y);
  for (let index = 0; index < 5; index++) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.65);
  const taggedDistance = Number(await canvas(page).getAttribute("data-camera-distance"));
  await selectChapter(page, "neogene", "Neogene");
  await expect(page).toHaveURL(/(?:#|&)focus=andes-volcanic-margin(?:&|$)/);
  await expect(page.locator(".selected-note")).toContainText("Andean volcanic margin");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(taggedDistance, 2);

  await selectChapter(page, "kpg-boundary", "K–Pg boundary");
  await expect(page).not.toHaveURL(/(?:#|&)focus=/);
  await expect(page.locator(".selected-note")).toHaveCount(0);

  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await expect(page.locator(".notes-list button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Chicxulub impact/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Andean volcanic margin/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View this chapter/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Chicxulub impact/ }).click();
  await expect(page.locator(".age-display")).toHaveText("66.04 Ma");
});

test("activates and clears one explicit surface focus without treating drags or space as clicks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");

  const center = await canvasPosition(page);
  await page.mouse.click(center.x, center.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(page).toHaveURL(/(?:#|&)at=-?\d+(?:\.\d+)?%2C-?\d+(?:\.\d+)?/);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.83);

  const focusedDistance = Number(await canvas(page).getAttribute("data-camera-distance"));
  await page.mouse.click(center.x, center.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
  await expect(page).not.toHaveURL(/(?:#|&)at=/);
  await page.waitForTimeout(150);
  expect(Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(focusedDistance, 3);

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 24, center.y + 18);
  await page.mouse.up();
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");

  await openMenu(page);
  await page.getByRole("menuitem", { name: "Reset camera" }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeGreaterThan(3.5);
  const outside = await canvasPosition(page, 0.01, 0.01);
  await page.mouse.click(outside.x, outside.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");

  const overviewCenter = await canvasPosition(page);
  await page.mouse.click(overviewCenter.x, overviewCenter.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(page).toHaveURL(/(?:#|&)at=/);
  await page.reload();
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(page).toHaveURL(/(?:#|&)at=/);

  await openMenu(page);
  await page.getByRole("menuitem", { name: "Reset camera" }).click();
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
  await expect(page).not.toHaveURL(/(?:#|&)at=/);
});

test("retains a land anchor through disappearance and reacquires its exact source part", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const track = [
    "1",
    "paleomap-country-tracking-v1",
    "paleomap-global-plate-model-v3",
    "anchor-plate-0",
    "GPlates-2718995b-b38a-44d8-9692-faa1a225003c",
    "275",
    "0.5",
    "0",
    "0",
  ].join("~");
  const params = new URLSearchParams({
    age: "0",
    layers: "borders,tectonics",
    relief: "8",
    track,
  });
  await page.goto(`./#${params}`);
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  const presentAt = new URL(page.url()).hash.match(/(?:#|&)at=([^&]+)/)?.[1];
  expect(presentAt).toBeTruthy();
  const center = await canvasPosition(page);
  await page.mouse.move(center.x, center.y);
  for (let index = 0; index < 5; index++) await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.65);
  const taggedDistance = Number(await canvas(page).getAttribute("data-camera-distance"));

  await page.locator("#chapter-jump").selectOption("ordovician");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
  const retainedStatus = page.getByText(/Tracked land unavailable.*tag retained/);
  await expect(retainedStatus).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("track")).toBe(track);
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).has("at")).toBe(false);

  await page.locator("#chapter-jump").selectOption("silurian");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(retainedStatus).toHaveCount(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeCloseTo(taggedDistance, 2);
  const reappearedAt = new URL(page.url()).hash.match(/(?:#|&)at=([^&]+)/)?.[1];
  expect(reappearedAt).toBeTruthy();
  expect(reappearedAt).not.toBe(presentAt);
});

test("keeps the cleared focus camera pose stationary with normal motion enabled", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  const center = await canvasPosition(page);
  await page.mouse.click(center.x, center.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "area");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.83);

  await page.mouse.click(center.x, center.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
  // Camera-coordinate diagnostics update on a throttled cadence; allow the
  // post-click sample to settle before comparing two subsequent samples.
  await page.waitForTimeout(2_200);
  const before = {
    longitude: Number(await canvas(page).getAttribute("data-camera-longitude")),
    distance: Number(await canvas(page).getAttribute("data-camera-distance")),
  };
  await page.waitForTimeout(1_500);
  const after = {
    longitude: Number(await canvas(page).getAttribute("data-camera-longitude")),
    distance: Number(await canvas(page).getAttribute("data-camera-distance")),
  };
  expect(Math.abs(after.longitude - before.longitude)).toBeLessThan(0.05);
  expect(after.distance).toBeCloseTo(before.distance, 3);
});

test("makes positioned notes the sole POI focus and clears them from the globe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await waitForSurface(page);
  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await page.getByRole("button", { name: /Andean volcanic margin/ }).click();
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "poi");
  await expect(page).toHaveURL(/(?:#|&)focus=andes-volcanic-margin(?:&|$)/);
  await expect(page).not.toHaveURL(/(?:#|&)(?:place|at)=/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.83);
  await page.reload();
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "poi");
  await expect(page).toHaveURL(/(?:#|&)focus=andes-volcanic-margin(?:&|$)/);
  await expect(page).not.toHaveURL(/(?:#|&)(?:place|at)=/);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")))
    .toBeLessThan(1.83);

  const surface = await canvasPosition(page, 0.25, 0.5);
  await page.mouse.click(surface.x, surface.y);
  await expect(canvas(page)).toHaveAttribute("data-focus-kind", "none");
  await expect(page).not.toHaveURL(/(?:#|&)focus=/);
  await expect(page.locator(".selected-note")).toHaveCount(0);
});

test("keeps niche actions unique in a keyboard accessible menu", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  await expect(page.locator(".tool-rail")).toHaveCount(0);
  await expect(page.locator(".journey-rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Field notes", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Share view" })).toHaveCount(0);

  const menuButton = page.getByRole("button", { name: "Open menu" });
  await menuButton.focus();
  await menuButton.press("Enter");
  const menu = page.getByRole("menu", { name: "Explore tools" });
  const firstMenuItem = page.getByRole("menuitem", { name: /^Layers & relief/ });
  await expect(firstMenuItem).toBeFocused();
  await expect(menu.locator('[role="menuitem"][tabindex="0"]')).toHaveCount(1);
  for (const name of [/^Layers & relief/, "Reset camera", /^Rendering quality/, "Sources", "About", "Share view"]) {
    await expect(page.getByRole("menuitem", { name })).toHaveCount(1);
  }
  await page.keyboard.press("ArrowDown");
  const resetMenuItem = page.getByRole("menuitem", { name: "Reset camera" });
  await expect(resetMenuItem).toBeFocused();
  await expect(resetMenuItem).toHaveAttribute("tabindex", "0");
  await expect(firstMenuItem).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await menuButton.press("Enter");
  await expect(firstMenuItem).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(".chapter-reference a")).toBeFocused();

  await menuButton.focus();
  await menuButton.press("Enter");
  await expect(firstMenuItem).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menuButton).toBeFocused();
});

test("preserves modal focus behavior and separates the globe from the timeline", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Sources" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(menuButton).toBeFocused();

  const stageBox = await page.locator(".globe-stage").boundingBox();
  const timelineBox = await page.locator(".timeline").boundingBox();
  const contextBox = await page.locator(".context-panel").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(contextBox).not.toBeNull();
  expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(timelineBox!.y + 1);
  expect(stageBox!.x).toBeGreaterThanOrEqual(contextBox!.x + contextBox!.width - 20);
  const labels = await page.locator(".timeline-chapters > span").evaluateAll((labels) =>
    labels.map((label) => {
      const box = label.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }).sort((left, right) => left.left - right.left),
  );
  for (let index = 1; index < labels.length; index++) {
    expect(labels[index].left).toBeGreaterThanOrEqual(labels[index - 1].right);
  }
});

test("keeps the mobile globe and controls inside their available viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await waitForSurface(page);
  const stageBox = await page.locator(".globe-stage").boundingBox();
  const timelineBox = await page.locator(".timeline").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(stageBox!.x).toBeGreaterThanOrEqual(0);
  expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(390);
  expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(timelineBox!.y + 1);
  const chapterCard = page.getByRole("complementary", { name: "Current chapter" });
  const contextToggle = page.getByRole("button", { name: /Current period Quaternary/ });
  await expect(chapterCard).toHaveAttribute("data-expanded", "false");
  await expect(contextToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await expect(page.locator(".chapter-reference")).toBeHidden();
  const collapsedBox = await chapterCard.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.height).toBeLessThanOrEqual(70);

  await contextToggle.click();
  await expect(contextToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.locator(".chapter-reference a")).toBeVisible();
  const expandedBox = await chapterCard.boundingBox();
  expect(expandedBox).not.toBeNull();
  expect(expandedBox!.height).toBeGreaterThan(collapsedBox!.height);
  await contextToggle.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();

  await openMenu(page);
  await expect(page.getByRole("menuitem", { name: /^Layers & relief/ })).toBeVisible();
});

test("shows a resolved chapter reference for every authored chapter", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  const picker = page.locator("#chapter-jump");
  const chapterIds = await picker.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  for (const chapterId of chapterIds) {
    await picker.selectOption(chapterId);
    const reference = page.locator(".chapter-reference a");
    await expect(reference).toHaveCount(1);
    await expect(reference).toHaveAttribute("href", /^https?:\/\//);
    await expect(reference.locator("strong")).not.toHaveText("");
  }
});
