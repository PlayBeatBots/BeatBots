// Timing/perf: load metrics (DCL, load, LCP, CLS), transferred bytes by type, third-party requests,
// and long main-thread tasks. Third-party hosts (Tailwind CDN, unpkg, RPC) are aborted by default
// so numbers reflect our own payload; pass --live to let them through.
// Usage: node tools/qa/timing.cjs <siteDir> <outDir> [--live]
const fs = require('fs'), path = require('path');
const { launch, serve, watchErrors, out, BASE, PAGES } = require('./lib.cjs');

(async () => {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const [siteDir, outDir = 'qa-out/timing'] = args.filter(a => !a.startsWith('--'));
  out(outDir);
  const b = await launch();
  const m = {}; const errors = []; const thirdParty = [];
  for (const pg of PAGES) {
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  errors.push(...watchErrors(page));
  if (!live) await page.route(u => !u.href.startsWith(BASE), r => { thirdParty.push(r.request().url()); r.abort(); });
  else page.on('request', r => { if (!r.url().startsWith(BASE)) thirdParty.push(r.url()); });
  await serve(page, siteDir);
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0; window.__long = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(BASE + pg, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  m[pg] = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const byType = {};
    for (const r of res) { const ext = (r.name.split('?')[0].match(/\.(\w+)$/) || [, 'other'])[1]; byType[ext] = (byType[ext] || 0) + (r.encodedBodySize || r.decodedBodySize || 0); }
    return { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3), longTasks: window.__long, requests: res.length, kbByType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])) };
  });
  await page.close();
  }
  // HTML/JS sizes from disk (resource timing has no sizes for routed responses)
  const sd = path.resolve(siteDir);
  const disk = {};
  for (const f of fs.readdirSync(sd)) { const p = path.join(sd, f); if (fs.statSync(p).isFile()) disk[f] = Math.round(fs.statSync(p).size / 1024); }
  const report = { live, pages: m, diskKB: disk, thirdParty: [...new Set(thirdParty.map(u => new URL(u).host))], errors };
  await b.close();
  fs.writeFileSync(path.join(outDir, 'timing_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
})();
