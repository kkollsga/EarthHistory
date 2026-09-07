#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const root = process.cwd();
const baseUrl = process.env.EARTHHISTORY_BENCH_URL ?? "http://127.0.0.1:4173";
const relief = Math.min(30, Math.max(1, Number(process.env.EARTHHISTORY_RELIEF ?? 8)));
const allIds = [
  "mid-atlantic-ridge",
  "himalayas",
  "andes",
  "east-african-rift",
  "greenland",
  "sahara-sahel",
  "amazon-rainforest",
  "eurasian-steppe",
  "siberian-boreal",
  "patagonia-rain-shadow",
];
const requested = process.argv.includes("--all")
  ? allIds
  : process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const ids = requested.length ? requested : ["himalayas"];
for (const id of ids) {
  if (!allIds.includes(id)) throw new Error(`Unknown modern landscape preset: ${id}`);
}

const previewDir = path.join(root, "docs/previews");
const resultPath = path.join(root, "dev-docs/bench/results/modern-landscape-checkpoint.json");
await mkdir(previewDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const events = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    events.push({ type: message.type(), text: message.text(), location: message.location() });
  }
});
page.on("pageerror", (error) => events.push({ type: "pageerror", text: error.message }));
const canvas = page.locator("canvas[aria-label='Interactive three-dimensional Earth']");

async function waitForLandscape(id) {
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    (presetId) => {
      const target = document.querySelector("canvas");
      const picker = document.querySelector("#landscape-jump");
      return picker?.value === presetId && target?.dataset.surfaceStatus === "ready" && target.dataset.regionalStatus === "ready";
    },
    id,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1_000);
}

try {
  const captures = [];
  for (const id of ids) {
    const params = new URLSearchParams({ age: "0", layers: "borders,tectonics", relief: String(relief) });
    await page.goto(`${baseUrl}/#${params}`, { waitUntil: "domcontentloaded" });
    await canvas.waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#landscape-jump").selectOption(id);
    await waitForLandscape(id);
    const suffix = relief === 8 ? "" : `-${relief}x`;
    const file = `docs/previews/modern-${id}${suffix}.jpg`;
    await page.screenshot({ path: path.join(root, file), type: "jpeg", quality: 84, fullPage: true });
    const state = await page.evaluate(() => {
      const target = document.querySelector("canvas");
      return {
        heading: document.querySelector("h1")?.textContent,
        landscape: document.querySelector(".landscape-summary strong")?.textContent,
        description: document.querySelector(".landscape-summary p")?.textContent,
        legend: document.querySelector(".surface-legend")?.textContent?.replace(/\s+/g, " ").trim(),
        canvas: target ? { ...target.dataset } : null,
        diagnostics: window.__earthHistoryDiagnostics ?? null,
      };
    });
    captures.push({ id, file, ...state });
  }

  const indexBytes = await readFile(path.join(root, "dist/index.html"));
  const result = {
    recordedAt: new Date().toISOString(),
    command: `node dev-docs/bench/scripts/capture-modern-landscapes.mjs ${process.argv.slice(2).join(" ")}`.trim(),
    baseUrl,
    buildIndexSha256: createHash("sha256").update(indexBytes).digest("hex"),
    browser: browser.version(),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    controls: { clouds: false, verticalExaggeration: relief },
    captures,
    events,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(resultPath);
  console.log(JSON.stringify({ captures, events }, null, 2));
} finally {
  await browser.close();
}
