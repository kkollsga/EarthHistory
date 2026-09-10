import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, '..', 'dev-docs', 'smoke');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });

// Wait for Cao foundation country lines to publish
await page.waitForFunction(() => {
  const el = document.querySelector('canvas');
  return el && Number(el.dataset.caoFoundationCountryLineSegments || 0) > 0;
}, { timeout: 60000 });

const canvas = page.locator('canvas').first();
const before = await canvas.evaluate((el) => ({
  countryRibbonVisible: el.dataset.countryRibbonVisible,
  countryLineSegments: el.dataset.caoFoundationCountryLineSegments,
  geographySupport: el.dataset.caoFoundationGeographySupport,
}));

// Try to ensure borders layer is on via UI if there's a control
const bordersToggle = page.getByText(/Modern-country reference|borders/i).first();
if (await bordersToggle.count()) {
  await bordersToggle.click({ timeout: 2000 }).catch(() => {});
}

await page.waitForTimeout(2000);
const after = await canvas.evaluate((el) => ({
  countryRibbonVisible: el.dataset.countryRibbonVisible,
  countryLineSegments: el.dataset.caoFoundationCountryLineSegments,
}));

await page.screenshot({ path: path.join(outDir, 'borders.png'), fullPage: false });
console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
