import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dev-docs', 'smoke');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors=[];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await page.goto('http://localhost:5173/?nocache=' + Date.now(), { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => {
  const el=document.querySelector('canvas');
  return el && el.dataset.caoFoundationGeographySupport === 'native-cao-foundation'
    && Number(el.dataset.caoFoundationCountryLineSegments||0)>0;
}, { timeout: 90000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, 'continents-present.png') });
const present = await page.locator('canvas').evaluate(el => ({...el.dataset}));
// jump Devonian
const selects = page.locator('select');
const n = await selects.count();
for (let i=0;i<n;i++){
  const select=selects.nth(i);
  const options=await select.locator('option').allTextContents();
  const match=options.find(t=>/Devon/i.test(t));
  if(match){ await select.selectOption({label:match}); break; }
}
for (let i=0;i<n;i++){
  const select=selects.nth(i);
  const options=await select.locator('option').allTextContents();
  const match=options.find(t=>/380 Ma/.test(t));
  if(match){ await select.selectOption({label:match}); break; }
}
await page.waitForTimeout(5000);
await page.waitForFunction(() => document.querySelector('canvas')?.dataset.caoFoundationGeographySupport === 'native-cao-foundation', {timeout:60000}).catch(()=>{});
await page.screenshot({ path: path.join(outDir, 'continents-devonian.png') });
const devon = await page.locator('canvas').evaluate(el => ({...el.dataset}));
const body = await page.locator('body').innerText();
const report={present, devon, errors, snippet: body.slice(0,800)};
writeFileSync(path.join(outDir,'continents-check.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
await browser.close();
