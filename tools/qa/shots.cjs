// Screenshots for visual review: first screen + full page at desktop 1440x900 and phone 390x844.
// Usage: node tools/qa/shots.cjs <siteDir> <outDir> [--sections]
// --sections also saves one image per <section id>.
const path = require('path');
const { launch, serve, watchErrors, out, BASE } = require('./lib.cjs');
const SIZES = { desktop: [1440, 900], mobile: [390, 844] };

(async () => {
  const args = process.argv.slice(2);
  const [siteDir, outDir = 'qa-out/shots'] = args.filter((a) => !a.startsWith('--'));
  const perSection = args.includes('--sections');
  out(outDir);
  const b = await launch();
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: name === 'mobile' ? 2 : 1 });
    const errors = watchErrors(page);
    await serve(page, siteDir);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `${name}-fold.png`) });
    await page.screenshot({ path: path.join(outDir, `${name}-full.png`), fullPage: true });
    if (perSection) {
      for (const id of await page.$$eval('main section[id]', (s) => s.map((e) => e.id))) {
        const el = await page.$('#' + id);
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await el.screenshot({ path: path.join(outDir, `${name}-${id}.png`) });
      }
    }
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(name, `${w}x${h}`, 'page height', height, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
    await page.close();
  }
  await b.close();
})();
