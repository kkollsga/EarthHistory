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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Present day");
  await expect(page.locator("#chapter-jump option")).toHaveCount(37);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "native-cao-foundation");
  await expect.poll(async () => Number(await globe(page).getAttribute("data-cao-foundation-vertices")))
    .toBeGreaterThan(100_000);
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
  await expect(page.locator("#source-age-jump")).toHaveValue("450");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "450");

  await page.goto("./#age=452.5");
  await page.reload();
  await waitForCao(page);
  await expect(page.locator(".geography-age").first()).toContainText("450–455 Ma native Cao controls");
  await expect(page.locator("#source-age-jump")).toHaveValue("interpolated");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-native-boundary-source-age-ma", "");
});

test("withholds a failed checkpoint and recovers without stale land", async ({ page }) => {
  let failures = 0;
  await page.route("**/checkpoint-450ma.json", async (route) => {
    if (failures++ === 0) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("./");
  await waitForCao(page);
  await page.locator("#source-age-jump").selectOption("450");
  await expect(page.getByText(/Cao reconstruction unavailable · surface withheld/)).toBeVisible();
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-status", "waiting");
  await page.locator("#source-age-jump").selectOption("445");
  await waitForCao(page);
  await page.locator("#source-age-jump").selectOption("450");
  await waitForCao(page);
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-requested-age-ma", "450");
});

test("labels editorial geography outside the live Cao package domain", async ({ page }) => {
  await page.goto("./#age=720");
  await expect(globe(page)).toBeVisible();
  // Direct deep-time entry has no in-domain publish yet, so native geography is withheld.
  await expect.poll(() => globe(page).getAttribute("data-cao-foundation-status")).toBe("unsupported");
  await expect(page.locator(".geography-age").first()).toContainText("Outside compiled domain");
  await expect(globe(page)).toHaveAttribute("data-cao-foundation-geography-support", "unsupported-editorial-uniform");
  await expect(page.locator("#timeline-scale")).toContainText("Precambrian");
  await expect(page.locator("#timeline-scale option[value='recent']")).toHaveCount(0);
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

  await page.locator("#chapter-jump").selectOption("cryogenian");
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
