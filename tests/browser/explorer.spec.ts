import { expect, test, type Page } from "@playwright/test";

const canvas = (page: Page) => page.locator("canvas[aria-label='Interactive three-dimensional Earth']");

async function waitForSurface(page: Page) {
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => canvas(page).getAttribute("data-surface-status")).toBe("ready");
}

async function selectChapter(page: Page, id: string, heading: string) {
  await page.locator("#chapter-jump").selectOption(id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  await expect(page.locator("#chapter-jump")).toHaveValue(id);
  await waitForSurface(page);
}

async function useHighDetail(page: Page) {
  await page.getByRole("button", { name: /^Rendering quality:/ }).click();
  await page.getByRole("button", { name: "High detail" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Rendering quality: high" })).toBeVisible();
  await expect.poll(() => canvas(page).getAttribute("data-quality")).toBe("high");
}

test("loads the Pages subpath with local assets and a complete chapter picker", async ({ page }) => {
  const externalRequests = new Set<string>();
  const failedResponses: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4174") externalRequests.add(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("./");
  await waitForSurface(page);

  await expect(page).toHaveTitle("Earth History");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.locator(".view-evidence")).toHaveText(/Rendered viewModel output/);
  await expect(page.locator("#chapter-jump option")).toHaveCount(37);
  expect(externalRequests).toEqual(new Set());
  expect(failedResponses).toEqual([]);
});

test("supports the explicit WebGL 2 fallback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./?renderer=webgl2");
  await waitForSurface(page);
  await expect(canvas(page)).toHaveAttribute("data-renderer-backend", "webgl2");
  expect(errors).toEqual([]);
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

  await page.getByRole("button", { name: "Choose visible layers" }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  const relief = page.getByRole("slider", { name: /^Terrain relief/ });
  await relief.fill("30");
  await expect(page.locator(".surface-legend")).toContainText("30×");
  await expect.poll(() => canvas(page).getAttribute("data-vertical-exaggeration")).toBe("30.0");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await useHighDetail(page);

  const bounds = await canvas(page).boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  for (let index = 0; index < 12; index++) await page.mouse.wheel(0, -300);
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await page.getByRole("button", { name: "Reset camera" }).click();
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("coarse");
});

test("opens repeatable modern landscape views and marks the seafloor explicitly", async ({ page }) => {
  test.slow();
  await page.goto("./");
  await waitForSurface(page);
  await useHighDetail(page);
  const landscapes = page.getByLabel("Explore a landscape");
  await expect(landscapes.locator("option")).toHaveCount(11);

  await landscapes.selectOption("mid-atlantic-ridge");
  await expect(page.locator(".landscape-summary")).toContainText("submerged divergent plate boundary");
  await expect(page.locator(".surface-legend")).toContainText("Seafloor view");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("seafloor");
  await waitForSurface(page);
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance")), {
    timeout: 3_000,
  }).toBeLessThan(1.82);
  await expect(page).toHaveURL(/place=mid-atlantic-ridge/);
  await page.reload();
  await waitForSurface(page);
  await useHighDetail(page);
  await expect(page.getByLabel("Explore a landscape")).toHaveValue("mid-atlantic-ridge");
  await expect.poll(() => canvas(page).getAttribute("data-detail")).toBe("regional");
  await expect.poll(async () => Number(await canvas(page).getAttribute("data-camera-distance"))).toBeLessThan(1.82);

  await page.getByRole("button", { name: "Choose visible layers" }).click();
  await expect(page.getByRole("button", { name: /^Clouds/ })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");

  await landscapes.selectOption("sahara-sahel");
  await expect(page.locator(".landscape-summary")).toContainText("semi-arid steppe and savanna");
  await expect.poll(() => canvas(page).getAttribute("data-surface-mode")).toBe("surface");
  await page.locator("#chapter-jump").selectOption("cretaceous");
  await expect(page.getByLabel("Explore a landscape")).toHaveCount(0);
  await expect(page).not.toHaveURL(/place=/);
});

test("offers detailed and deep-time geological scales with keyboard scrubbing", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  const recentEarth = page.getByRole("button", { name: "Recent Earth" });
  const phanerozoic = page.getByRole("button", { name: "Phanerozoic" });
  const deepTime = page.getByRole("button", { name: "Deep time" });
  const slider = page.getByRole("slider", { name: /^Geological age/ });
  await expect(recentEarth).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Last Glacial Maximum, 21 ka" }).click();
  await expect(page.locator(".age-display")).toHaveText("21 ka");

  await phanerozoic.click();
  await expect(phanerozoic).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".period-band")).toContainText("Cretaceous");

  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.locator(".timeline-handle-label")).not.toHaveText("Today");
  await expect(page.locator(".timeline-readout")).toContainText("Geography source: 0 Ma");

  await page.locator("#chapter-jump").selectOption("moon-forming-scenario");
  await expect(deepTime).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".geological-bands")).toContainText("Hadean");
  await phanerozoic.click();
  await expect(phanerozoic).toHaveAttribute("aria-pressed", "true");
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
  await expect.poll(async () => (await page.evaluate(() => window.__earthHistoryDiagnostics?.staleJobs ?? 0))).toBe(0);
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
});

test("preserves modal focus behavior and separates the globe from the timeline", async ({ page }) => {
  await page.goto("./");
  await waitForSurface(page);
  const sourceButton = page.getByRole("button", { name: "Open sources" });
  await sourceButton.focus();
  await sourceButton.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(sourceButton).toBeFocused();

  const stageBox = await page.locator(".globe-stage").boundingBox();
  const timelineBox = await page.locator(".timeline").boundingBox();
  const contextBox = await page.locator(".context-panel").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(contextBox).not.toBeNull();
  expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(timelineBox!.y + 1);
  expect(stageBox!.x).toBeGreaterThanOrEqual(contextBox!.x + contextBox!.width - 20);
  const labels = await page.locator(".timeline-chapters button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose visible layers" })).toBeVisible();
});
