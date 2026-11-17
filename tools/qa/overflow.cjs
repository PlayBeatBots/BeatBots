// Overflow check: horizontal scroll and elements wider than the viewport at phone→desktop widths.
// Usage: node tools/qa/overflow.cjs <siteDir> <outDir>
const fs = require('fs'), path = require('path');
const { launch, serve, watchErrors, out, BASE } = require('./lib.cjs');
const WIDTHS = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440];

(async () => {
  const [siteDir, outDir = 'qa-out/overflow'] = process.argv.slice(2);
  out(outDir);
  const b = await launch();
  const report = {}; const fail = [];
  for (const w of WIDTHS) {
    const page = await b.newPage({ viewport: { width: w, height: 800 } });
    watchErrors(page); await serve(page, siteDir);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rc = el.getBoundingClientRect();
        if (rc.width && rc.right > vw + 1) {
          // skip if an ancestor clips overflow
          let a = el.parentElement, clipped = false;
          while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') { clipped = true; break; } a = a.parentElement; }
          if (!clipped) offenders.push({ tag: el.tagName.toLowerCase(), id: el.id, cls: (el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 60), right: Math.round(rc.right) });
        }
      }
      return { vw, sw, scrolls: sw > vw + 1, offenders: offenders.slice(0, 15) };
    });
    report[w] = r;
    if (r.scrolls) { fail.push(`${w}px: page scrolls sideways (${r.sw} > ${r.vw})`); await page.screenshot({ path: path.join(outDir, `overflow-${w}.png`) }); }
    await page.close();
  }
  await b.close();
  fs.writeFileSync(path.join(outDir, 'overflow_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fail, offendersAt320: report[320].offenders.slice(0, 5) }, null, 1));
  process.exit(fail.length ? 1 : 0);
})();
