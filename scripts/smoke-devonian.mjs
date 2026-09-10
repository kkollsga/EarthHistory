import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, '..', 'dev-docs', 'smoke');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => {
  const el = document.querySelector('canvas');
  return el && Number(el.dataset.caoFoundationCountryLineSegments || 0) > 0;
}, { timeout: 60000 });

// Prefer reconstruction jump to Devonian ~385 Ma if available
const recon = page.getByLabel(/JUMP TO RECONSTRUCTION|reconstruction/i).or(page.locator('select, button', { hasText: /RECONSTRUCTION|native Cao/i }));
// Try chapter jump first
async function pickOptionContaining(labelRe, valueRe) {
  // open any select-like control near the label
  const label = page.getByText(labelRe).first();
  if (await label.count()) {
    const container = label.locator('xpath=ancestor::*[self::label or self::div][1]');
    const select = container.locator('select').first();
    if (await select.count()) {
      const options = await select.locator('option').allTextContents();
      const match = options.find((t) => valueRe.test(t));
      if (match) {
        await select.selectOption({ label: match });
        return match;
      }
    }
  }
  // fallback: any select on page
  const selects = page.locator('select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const select = selects.nth(i);
    const options = await select.locator('option').allTextContents();
    const match = options.find((t) => valueRe.test(t));
    if (match) {
      await select.selectOption({ label: match });
      return match;
    }
  }
  return null;
}

const chapterPick = await pickOptionContaining(/JUMP TO CHAPTER/i, /Devon/i);
const reconPick = await pickOptionContaining(/JUMP TO RECONSTRUCTION/i, /385|380|Devonian/i);

// If selects didn't work, try clicking list items / buttons
if (!chapterPick && !reconPick) {
  const devon = page.getByText(/Devon/i).first();
  if (await devon.count()) await devon.click();
}

await page.waitForTimeout(4000);
await page.waitForFunction(() => {
  const el = document.querySelector('canvas');
  return el && el.dataset.caoFoundationGeographySupport === 'native-cao-foundation';
}, { timeout: 60000 }).catch(() => {});

const canvas = page.locator('canvas').first();
const meta = await canvas.evaluate((el) => ({ ...el.dataset }));
const bodyText = await page.locator('body').innerText();
const titleBits = bodyText.split('\n').slice(0, 40);

await page.screenshot({ path: path.join(outDir, 'devonian.png'), fullPage: false });
const report = { chapterPick, reconPick, meta: {
  countryRibbonVisible: meta.countryRibbonVisible,
  countryLineSegments: meta.caoFoundationCountryLineSegments,
  geographySupport: meta.caoFoundationGeographySupport,
  nativeBoundarySourceAgeMa: meta.caoFoundationNativeBoundarySourceAgeMa,
}, titleBits, errors, bodySnippet: bodyText.slice(0, 1200) };
writeFileSync(path.join(outDir, 'devonian.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
