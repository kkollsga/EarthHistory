#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const root = process.cwd();
const baseUrl = process.env.EARTHHISTORY_BENCH_URL ?? "http://127.0.0.1:4173";
const out = path.join(root, "dev-docs/bench/out");
const resultPath = path.join(root, "dev-docs/bench/results/visual-checkpoint.json");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const events = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    events.push({ type: message.type(), text: message.text(), location: message.location() });
  }
});
page.on("pageerror", (error) => events.push({ type: "pageerror", text: error.message }));

const canvas = page.locator("canvas");
const captures = [];

async function waitReady() {
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => {
    const target = document.querySelector("canvas");
    return target?.dataset.surfaceStatus === "ready" && window.__earthHistoryDiagnostics;
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function capture(name) {
  await waitReady();
  const file = `dev-docs/bench/out/${name}.png`;
  await page.screenshot({ path: path.join(root, file), fullPage: true });
  const state = await page.evaluate(() => ({
    heading: document.querySelector("h1")?.textContent,
    sourceAge: document.querySelector(".geography-age strong")?.textContent,
    diagnostic: window.__earthHistoryDiagnostics,
    canvas: { ...document.querySelector("canvas").dataset },
  }));
  captures.push({ file, ...state });
}

async function setRelief(value) {
  await page.getByRole("button", { name: "Choose visible layers" }).click();
  await page.getByRole("slider", { name: /^Terrain relief/ }).fill(String(value));
  await page.waitForFunction(
    (expected) => document.querySelector("canvas")?.dataset.verticalExaggeration === `${expected}.0`,
    value,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
}

async function selectChapter(id, heading) {
  const previous = Number(await canvas.getAttribute("data-surface-ready-at") ?? 0);
  await page.locator("#chapter-jump").selectOption(id);
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  await page.waitForFunction(() => document.querySelector(".geography-age strong")?.textContent !== "Resolving…");
  await page.waitForFunction(
    (readyAt) => Number(document.querySelector("canvas")?.dataset.surfaceReadyAt ?? 0) > readyAt,
    previous,
    { timeout: 30_000 },
  );
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await capture("ui-modern-orbit-8x-clouds-off");

  await page.getByRole("button", { name: "Field notes", exact: true }).click();
  await page.getByRole("button", { name: /Andean volcanic margin/ }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.waitForTimeout(1_300);
  await setRelief(1);
  await capture("ui-andes-regional-1x");
  await setRelief(30);
  await capture("ui-andes-regional-30x");

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitReady();
  await page.getByRole("button", { name: "Choose visible layers" }).click();
  await page.getByRole("button", { name: /^Clouds/ }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await capture("ui-modern-orbit-8x-clouds-on");

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitReady();
  await selectChapter("moon-forming-scenario", "Moon-forming impact scenario");
  await capture("ui-moon-impact-8x");
  await selectChapter("hadean-cooling-crust", "Crust begins to cool");
  await capture("ui-cooling-crust-8x");
  await selectChapter("quaternary-lgm", "Last Glacial Maximum");
  await capture("ui-last-glacial-maximum-8x");

  await writeFile(resultPath, `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    baseUrl,
    browser: browser.version(),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    captures,
    events,
  }, null, 2)}\n`);
  console.log(resultPath);
  console.log(JSON.stringify({ captures, events }, null, 2));
} finally {
  await browser.close();
}
