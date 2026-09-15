// Scrub scheduling benchmark. Inputs: a gzip static server for one dist
// (baseline or candidate), Chrome stable via Playwright, mobile emulation
// 390x844 @2x, CDP network 60 ms / 1.5 MB/s. Gesture: #age=0 -> 2..70 Ma in
// 2 Ma steps every 40 ms. Statistic: per-run values and medians over N runs.
// Usage: node scrub-scheduling-benchmark.mjs <port> <label> <out.json> [runs]
// Serve a dist with reports/serve-root.mjs style gzip server first.
import { chromium } from '/Volumes/EksternalHome/Koding/HTML/EarthHistory/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const [,, port, label, outPath, runsArg] = process.argv;
const runs = Number(runsArg ?? 3);
const url = `http://127.0.0.1:${port}/EarthHistory`;
const tileRe = /motion-tiles\/tile-.*\.ehmt/; const fullRe = /motion-palette\.bin/; const cpRe = /(checkpoint|boundary|ownership)-\d+ma\./;
const burst = []; for (let a = 2; a <= 70; a += 2) burst.push(a);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const results = [];
try {
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 1_500_000, uploadThroughput: 750_000 });
    const events = [];
    const t0 = Date.now();
    const kind = (u) => tileRe.test(u) ? 'tile' : fullRe.test(u) ? 'full' : cpRe.test(u) ? 'checkpoint' : null;
    page.on('request', (r) => { const k = kind(r.url()); if (k) events.push({ at: Date.now() - t0, kind: k, ev: 'start', url: r.url().split('/').pop().split('?')[0] }); });
    page.on('requestfailed', (r) => { const k = kind(r.url()); if (k) events.push({ at: Date.now() - t0, kind: k, ev: 'failed', url: r.url().split('/').pop().split('?')[0], error: r.failure()?.errorText ?? null }); });
    page.on('requestfinished', (r) => { const k = kind(r.url()); if (k) events.push({ at: Date.now() - t0, kind: k, ev: 'finished', url: r.url().split('/').pop().split('?')[0] }); });
    await context.addInitScript(() => {
      window.__trace = []; window.__longTasks = [];
      try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
      const record = () => {
        const c = document.querySelector('canvas'), s = document.querySelector('.globe-stage');
        if (!c || !s) return;
        const row = { at: performance.now(), status: c.dataset.caoFoundationStatus, draw: Number(c.dataset.caoFoundationDrawCount), canvasAge: Number(c.dataset.caoFoundationRequestedAgeMa), requested: Number(s.dataset.caoRequestedAgeMa), displayed: Number(s.dataset.caoDisplayedAgeMa), foreground: s.dataset.caoMotionForegroundStatus, timeline: s.dataset.caoTimelineLoadingStatus, tier: s.dataset.caoMotionTier };
        const last = window.__trace.at(-1);
        if (!last || Object.keys(row).some((k) => k !== 'at' && row[k] !== last[k])) window.__trace.push(row);
      };
      new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true });
      setInterval(record, 8);
    });
    const navStart = Date.now() - t0;
    await page.goto(`${url}/#age=0&layers=borders&relief=8&coordinates=cao`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.caoFoundationStatus === 'ready' && ['loading', 'ready', 'paused'].includes(document.querySelector('.globe-stage')?.dataset.caoTimelineLoadingStatus ?? ''), { timeout: 90_000 });
    const readyAt = Date.now() - t0;
    await page.locator('#timeline-scale').selectOption('phanerozoic');
    const burstTimes = await page.locator('#geological-age').evaluate(async (el, ages) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const start = performance.now();
      let lastInput = start;
      for (const age of ages) { setter.call(el, String(age / 538.8 * 1000)); el.dispatchEvent(new Event('input', { bubbles: true })); lastInput = performance.now(); await new Promise((r) => setTimeout(r, 40)); }
      return { start, lastInput, end: performance.now() };
    }, burst);
    const burstEndWall = Date.now() - t0;
    await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.dataset.caoFoundationStatus === 'ready' && Math.abs(Number(c.dataset.caoFoundationRequestedAgeMa) - 70) < 1e-6; }, { timeout: 90_000 });
    const settleWall = Date.now() - t0;
    let fullAt = null;
    try {
      await page.waitForFunction(() => { const s = document.querySelector('.globe-stage'); return s?.dataset.caoMotionTier === 'full' || s?.dataset.caoTimelineLoadingStatus === 'paused'; }, { timeout: 90_000 });
      fullAt = Date.now() - t0;
    } catch { fullAt = null; }
    const cadence = await page.evaluate(() => new Promise((resolve) => { const d = []; let last = performance.now(); const t = performance.now(); const tick = () => { const n = performance.now(); d.push(n - last); last = n; if (n - t < 2000) requestAnimationFrame(tick); else resolve(d); }; requestAnimationFrame(tick); }));
    const trace = await page.evaluate(() => window.__trace);
    const longTasks = await page.evaluate(() => window.__longTasks);
    const inBurst = trace.filter((r) => r.at >= burstTimes.start && r.at <= burstTimes.start + (settleWall - burstEndWall) + (burstTimes.end - burstTimes.start));
    const settleRow = trace.find((r) => r.at >= burstTimes.lastInput && r.status === 'ready' && Math.abs(r.canvasAge - 70) < 1e-6);
    const count = (k, ev) => events.filter((e) => e.kind === k && e.ev === ev).length;
    const during = (k) => events.filter((e) => e.kind === k && e.ev === 'start' && e.at >= burstEndWall - (burstTimes.end - burstTimes.start) && e.at <= settleWall).length;
    const sorted = [...cadence].sort((a, b) => a - b);
    const result = { run, readyMs: readyAt - navStart, settleMs: settleRow ? settleRow.at - burstTimes.lastInput : settleWall - burstEndWall, longTasksDuringBurst: longTasks.filter((t) => t.start >= burstTimes.start && t.start <= (settleRow?.at ?? burstTimes.end)).length, settleRowFound: Boolean(settleRow),
      fullPaletteMsFromNav: fullAt === null ? null : fullAt - navStart, finalTier: trace.at(-1)?.tier, finalTimeline: trace.at(-1)?.timeline,
      tileStarts: count('tile', 'start'), tileAborts: count('tile', 'failed'), fullStarts: count('full', 'start'), fullAborts: count('full', 'failed'), checkpointStarts: count('checkpoint', 'start'), checkpointStartsDuringBurst: during('checkpoint'),
      blankRowsDuringBurst: inBurst.filter((r) => r.draw === 0 || r.status === 'waiting').length, rowsDuringBurst: inBurst.length,
      rafP50: sorted[Math.floor(sorted.length / 2)], rafP95: sorted[Math.floor(sorted.length * 0.95)], burstTimes, longTasksAfterBurst: longTasks.filter((t) => t.start >= burstTimes.start - 500), traceWindow: trace.filter((r) => r.at >= burstTimes.end - 300 && r.at <= burstTimes.end + 1500), events };
    results.push(result);
    console.log(JSON.stringify({ ...result, events: undefined, traceWindow: undefined, longTasksAfterBurst: undefined }));
    await context.close();
  }
} finally { await browser.close(); }
const summary = { label, port, burst, runs: results.map((r) => ({ ...r, events: undefined, traceWindow: undefined, longTasksAfterBurst: undefined })), events: results.map((r) => r.events), traceWindows: results.map((r) => r.traceWindow), longTasks: results.map((r) => r.longTasksAfterBurst),
  medians: { settleMs: median(results.map((r) => r.settleMs)), readyMs: median(results.map((r) => r.readyMs)), fullPaletteMsFromNav: median(results.map((r) => r.fullPaletteMsFromNav).filter((x) => x !== null)), tileStarts: median(results.map((r) => r.tileStarts)), tileAborts: median(results.map((r) => r.tileAborts)), fullStarts: median(results.map((r) => r.fullStarts)), fullAborts: median(results.map((r) => r.fullAborts)), checkpointStartsDuringBurst: median(results.map((r) => r.checkpointStartsDuringBurst)), blankRowsDuringBurst: median(results.map((r) => r.blankRowsDuringBurst)), longTasksDuringBurst: median(results.map((r) => r.longTasksDuringBurst)), rafP50: median(results.map((r) => r.rafP50)) } };
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
console.log('MEDIANS', JSON.stringify(summary.medians));
