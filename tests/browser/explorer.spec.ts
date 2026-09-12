import { expect, test, type Page } from "@playwright/test";

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
    return value !== undefined && Math.abs(Number(value) - age) <= 1e-6;
  }, ageMa, { timeout: 20_000 });
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
test("supports the TSL WebGL2 fallback", { tag: "@ci" }, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./?renderer=webgl2");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-renderer-backend", "webgl2");
  expect(errors).toEqual([]);
});

test("distinguishes exact native checkpoints from continuous motion", async ({ page }) => {
  await page.goto("./#age=450");
  await waitForCao(page);
  await expect(page.locator(".geography-age").first()).toContainText("450 Ma native Cao checkpoint");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "4");
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
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "10");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-formation-uncertain-material-charts", "2");
  await expect(globe(page)).toHaveAttribute("data-cao-model-inferred-pose-charts", "10");

  await page.goto("./#age=410.0000001");
  await page.reload();
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-formation-range-material");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "15");
  await expect(globe(page)).toHaveAttribute("data-cao-formation-uncertain-material-charts", "2");
  await expect(page.getByText(/Ochre: source-supported material footprint/)).toBeVisible();

  await page.goto("./#age=430");
  await page.reload();
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "14");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "1");

  await page.goto("./#age=430.0000001");
  await page.reload();
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "cao-plus-formation-range-material");
  await expect(globe(page)).toHaveAttribute("data-cao-qualified-material-charts", "4");
  await expect(globe(page)).toHaveAttribute("data-cao-uncertain-material-charts", "11");
  await expect(page.getByText(/Gray: continued material with older pose uncertainty/)).toBeVisible();
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
  await expect(page.getByText(/Cao reconstruction unavailable · surface withheld/)).toBeVisible();
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

test("ignores a stale checkpoint failure after a newer age retargets", async ({ page }) => {
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
  await expect(stage).toHaveAttribute("data-cao-last-prepare-failed-age-ma", "450");
  await expect(stage).toHaveAttribute("data-cao-last-prepare-failure-observed-age-ma", "445");
  await waitForCao(page);
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
  await expect(page.getByText(/Ochre: source-supported material footprint/)).toBeVisible();
  await page.locator("#chapter-jump").selectOption("moon-forming-scenario");
  await expect(page.locator(".geography-age").first()).toContainText("Outside compiled domain");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "unsupported");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-draw-count", "0");
  await expect(globe(page)).toHaveAttribute("data-cao-overridden-native-charts", "0");
  await expect(page.getByText(/Ochre: source-supported material footprint/)).toHaveCount(0);
  await expect(page.getByText(/Gray: continued material with older pose uncertainty/)).toHaveCount(0);
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
  await page.mouse.click(center.x, center.y);
  await expect.poll(() =>
    new URLSearchParams(new URL(page.url()).hash.slice(1)).get("material"),
  ).not.toBeNull();
  const material = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("material");
  expect(material).not.toBeNull();
  await expect(globe(page)).toHaveAttribute("data-focus-kind", "area");
  await expect(globe(page)).toHaveAttribute("data-focus-marker", "true");
  await expect(page.getByTestId("location-lock")).toContainText(/Location locked/);
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
