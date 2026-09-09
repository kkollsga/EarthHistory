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

test("lazily creates and then toggles bounded schematic reference guides", async ({ page }) => {
  await page.goto("./#age=0&layers=borders,tectonics&relief=8");
  await waitForSurface(page);
  const target = canvas(page);
  await expect(target).toHaveAttribute("data-country-ribbon-batches", "2");
  await expect(target).toHaveAttribute("data-reference-guide-batches", "0");

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  const guides = page.getByRole("button", { name: /^Reference guides/ });
  await expect(guides).toHaveAttribute("aria-pressed", "false");
  await guides.click();
  await expect(guides).toHaveAttribute("aria-pressed", "true");
  await expect(target).toHaveAttribute("data-reference-guide-visible", "true");
  await expect(target).toHaveAttribute("data-reference-guide-batches", "1");
  await expect(page.locator(".surface-legend")).toContainText(/schematic climate guides/i);
  const created = await target.evaluate((element) => ({
    bytes: element.dataset.referenceGuideBytes,
    vertices: element.dataset.referenceGuideVertices,
  }));
  expect(Number(created.bytes)).toBeLessThanOrEqual(2 * 1024 * 1024);

  await guides.click();
  await expect(target).toHaveAttribute("data-reference-guide-visible", "false");
  await expect(target).toHaveAttribute("data-reference-guide-bytes", created.bytes!);
  await expect(target).toHaveAttribute("data-reference-guide-vertices", created.vertices!);
});

test("keeps story age, title, and geographic source age distinct", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);

  await selectChapter(page, "quaternary-lgm", "Last Glacial Maximum");
  await expect(page.locator(".age-display")).toHaveText("21 ka");
  await expect(page.locator(".geography-age")).toContainText("0 Ma (present-day grid)");

  await selectChapter(page, "permian", "Permian");
  await expect(page.locator(".age-display")).toHaveText("255 Ma");
  await expect(page.locator(".geography-age")).toContainText("250 Ma");

  await selectChapter(page, "kpg-boundary", "K–Pg boundary");
  await expect(page.locator(".age-display")).toHaveText("66.04 Ma");
  await expect(page.locator(".geography-age")).toContainText("65 Ma");

  await selectChapter(page, "antarctic-glaciation", "Antarctic glaciation");
  await expect(page.locator(".age-display")).toHaveText("33.6 Ma");
  await expect(page.locator(".geography-age")).toContainText("35 Ma");

  await selectChapter(page, "moon-forming-scenario", "Moon-forming impact scenario");
  await expect(page.locator(".scenario-label")).toHaveText("Illustrative scene · geography unresolved");
  await expect(page.locator(".geography-age")).toContainText("Illustrative field");
});

test("changes relief, keeps clouds off by default, and restores an orbital camera", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  await expect(page.locator(".surface-legend")).toContainText("8×");

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  const relief = page.getByRole("slider", { name: /^Terrain relief/ });
  await relief.fill("30");
  await expect(page.locator(".surface-legend")).toContainText("30×");
  await expect.poll(() => canvas(page).getAttribute("data-vertical-exaggeration")).toBe("30.0");
  await expect(canvas(page)).toHaveAttribute("data-overlay-drape-status", "ready");
  await expect(canvas(page)).toHaveAttribute("data-overlay-drape-exaggeration", "30.0");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-overlay-drape-vertices")))
    .toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-overlay-drape-cache-bytes")))
    .toBeLessThanOrEqual(16 * 1024 * 1024);
  await expect.poll(async () => {
    const target = canvas(page);
    return await target.getAttribute("data-overlay-drape-surface-key") ===
      await target.getAttribute("data-cube-displayed-key");
  }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await useHighDetail(page);

  const bounds = await canvas(page).boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  for (let index = 0; index < 12; index++) await page.mouse.wheel(0, -300);
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await waitForRefinedCube(page, /:surface:regional:/);
  await expect.poll(async () => {
    const target = canvas(page);
    return await target.getAttribute("data-overlay-drape-surface-key") ===
      await target.getAttribute("data-cube-displayed-key");
  }).toBe(true);
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Reset camera" }).click();
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("coarse");
});

test("opens repeatable modern landscape views and marks the seafloor explicitly", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  await useHighDetail(page);
  const landscapes = page.getByLabel("Explore a landscape");
  await expect(landscapes.locator("option")).toHaveCount(12);

  await landscapes.selectOption("mid-atlantic-ridge");
  await expect(page.locator(".landscape-summary")).toContainText("submerged divergent plate boundary");
  await expect(page.locator(".surface-legend")).toContainText("Seafloor view");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("seafloor");
  await waitForSurface(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")), {
    timeout: 3_000,
  }).toBeLessThan(1.82);
  await waitForRefinedCube(page, /:seafloor:regional:ETOPO_2022_v1_60s_surface:mid-atlantic-ridge$/);
  await expect(page).toHaveURL(/place=mid-atlantic-ridge/);
  await page.reload();
  await waitForSurface(page);
  await useHighDetail(page);
  await expect(page.getByLabel("Explore a landscape")).toHaveValue("mid-atlantic-ridge");
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance"))).toBeLessThan(1.82);
  await waitForRefinedCube(page, /:seafloor:regional:ETOPO_2022_v1_60s_surface:mid-atlantic-ridge$/);

  await openMenu(page);
  await page.getByRole("menuitem", { name: /^Layers & relief/ }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");

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
  await expect(page.locator(".timeline-readout")).toContainText("Geography source: 0 Ma");

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

test("crossfades completed authored scenes and settles rapid chapter changes on the latest request", async ({ page }) => {
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

  await page.locator("#chapter-jump").selectOption("permian");
  await page.locator("#chapter-jump").selectOption("kpg-boundary");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("K–Pg boundary");
  await waitForSurface(page);
  await expect.poll(() => canvas(page).getAttribute("data-surface-transition")).toBe("idle");
  const transitions = await page.evaluate(() =>
    (window as Window & { __surfaceTransitions?: string[] }).__surfaceTransitions ?? [],
  );
  expect(transitions).toContain("crossfade");
  await expect(page.locator(".geography-age")).toContainText("65 Ma");
  await waitForRefinedCube(
    page,
    /^kpg-boundary__paleodem-65ma:surface:coarse:procedural$/,
  );
});

test("a stale retry cannot replace a newer chapter", async ({ page }) => {
  let attempts = 0;
  await page.route("**/data/paleodem-250ma.json", async (route) => {
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
  await expect(page.locator(".geography-age")).toContainText("65 Ma");
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("K–Pg boundary");
  await expect(page.locator(".geography-age")).toContainText("65 Ma");
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
  await selectChapter(page, "neogene", "Neogene");
  await expect(page).toHaveURL(/(?:#|&)focus=andes-volcanic-margin(?:&|$)/);
  await expect(page.locator(".selected-note")).toContainText("Andean volcanic margin");

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
