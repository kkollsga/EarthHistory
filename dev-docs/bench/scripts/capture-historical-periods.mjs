import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Five bounded JPEG captures; reruns overwrite only this owned screenshot set.
const scenes = [
  ['carboniferous', 320], ['permian', 255], ['jurassic', 185],
  ['cretaceous', 95], ['miocene', 20],
];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const captures = [];
try {
  for (const [id, age] of scenes) {
    await page.goto(`http://127.0.0.1:4173/#age=${age}&layers=none&relief=8`);
    // Hash-only navigation does not remount the application initial state.
    await page.reload();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: /^Rendering quality/ }).click();
    await page.getByRole('button', { name: /^High detail/ }).click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.waitForFunction(() => {
      const d = document.querySelector('canvas')?.dataset;
      return d?.quality === 'high' && d.surfaceStatus === 'ready' &&
        d.cubeStatus === 'ready' && d.cubeRequestedKey === d.cubeDisplayedKey &&
        d.cubeRefinementStatus === 'ready' &&
        Number(d.cubeTargetLodCompleteAt) > Number(d.cubeTargetLodRequestedAt);
    }, undefined, { timeout: 30000 });
    await page.waitForTimeout(900);
    const file = `dev-docs/bench/out/history-${id}-8x.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
    const state = await page.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      age: document.querySelector('.age-display')?.textContent,
      geography: document.querySelector('.geography-age')?.textContent,
      canvas: {...document.querySelector('canvas').dataset},
    }));
    if (state.age !== `${age} Ma`) throw new Error(`Wrong captured age: ${state.age}`);
    captures.push({ id, file, ...state });
    console.log(JSON.stringify({ id, file, title: state.title, age: state.age, geography: state.geography }));
  }
  await writeFile('dev-docs/bench/results/historical-period-captures.json', JSON.stringify({
    recordedAt: new Date().toISOString(), browser: browser.version(),
    clouds: false, overlays: false, relief: 8, captures, errors,
  }, null, 2));
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally {
  await browser.close();
}
