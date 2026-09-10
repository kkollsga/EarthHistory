import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, '..', 'dev-docs', 'smoke');
mkdirSync(outDir, { recursive: true });
const shotPath = path.join(outDir, 'app.png');
const reportPath = path.join(outDir, 'report.json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
const title = await page.title();
const canvasCount = await page.locator('canvas').count();
const bodyText = await page.locator('body').innerText().catch(() => '');
const controls = await page.locator('button, [role="button"], input, select').count();
await page.screenshot({ path: shotPath, fullPage: false });
const report = { title, canvasCount, controls, bodyText: bodyText.slice(0, 2000), errors };
writeFileSync(reportPath, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({ ...report, shot: shotPath }, null, 2));
