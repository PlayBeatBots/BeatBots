// UI check: full-page screenshots at 5 viewports, console/page errors, broken in-page anchors,
// nav-on-one-line at >=1280px, banned real-name terms in visible text.
// Usage: node tools/qa/ui_check.cjs <siteDir> <outDir>
const fs = require('fs'), path = require('path');
const { launch, serve, watchErrors, out, BASE, VIEWPORTS } = require('./lib.cjs');

const BANNED = [/danny carey/i, /\bmarshall\b/i, /\bmpc\b/i, /cozza frenzy/i];

(async () => {
  const [siteDir, outDir = 'qa-out/ui'] = process.argv.slice(2);
  out(outDir);
  const b = await launch();
  const report = { viewports: {}, fail: [] };
  for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    const errors = watchErrors(page); const missing = [];
    await serve(page, siteDir, missing);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1);
      const brokenAnchors = [...new Set(anchors)].filter(h => !document.getElementById(h.slice(1)));
      const nav = document.querySelector('nav');
      let navLines = null;
      if (nav) {
        const tops = new Set([...nav.querySelectorAll('a,button')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().top / 8)));
        navLines = tops.size;
      }
      return { brokenAnchors, navLines, text: document.body.innerText, title: document.title };
    });
    const banned = BANNED.filter(r => r.test(info.text)).map(String);
    await page.screenshot({ path: path.join(outDir, `${name}-${w}.png`), fullPage: true });
    report.viewports[name] = { w, errors, missing: [...new Set(missing)], brokenAnchors: info.brokenAnchors, navLines: info.navLines, bannedVisible: banned };
    if (errors.length) report.fail.push(`${name}: ${errors.length} JS errors`);
    if (info.brokenAnchors.length) report.fail.push(`${name}: broken anchors ${info.brokenAnchors.join(' ')}`);
    if (w >= 1280 && info.navLines > 1) report.fail.push(`${name}: nav wraps to ${info.navLines} lines`);
    await page.close();
  }
  await b.close();
  fs.writeFileSync(path.join(outDir, 'ui_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fail: report.fail, banned: Object.values(report.viewports)[0].bannedVisible, missing: Object.values(report.viewports)[0].missing }, null, 1));
  process.exit(report.fail.length ? 1 : 0);
})();
