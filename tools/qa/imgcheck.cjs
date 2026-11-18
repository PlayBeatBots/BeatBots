// Image check: every <img>/CSS background loads, no local 404s, flags oversized images (>400 KB)
// and images rendered far smaller than their intrinsic size (>2.5x, wasted bytes).
// Usage: node tools/qa/imgcheck.cjs <siteDir> <outDir>
const fs = require('fs'), path = require('path');
const { launch, serve, watchErrors, out, BASE, PAGES } = require('./lib.cjs');

(async () => {
  const [siteDir, outDir = 'qa-out/img'] = process.argv.slice(2);
  out(outDir);
  const b = await launch();
  const missing = []; let imgs = [];
  for (const pg of PAGES) {
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  watchErrors(page);
  await serve(page, siteDir, missing);
  await page.goto(BASE + pg, { waitUntil: 'load' });
  // scroll to trigger lazy images
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
  await page.waitForTimeout(800);
  imgs = imgs.concat((await page.evaluate(() => [...document.images].map(i => ({
    src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0, nw: i.naturalWidth, rw: Math.round(i.getBoundingClientRect().width), alt: i.hasAttribute('alt'),
  })))).map((i) => Object.assign(i, { page: pg })));
  await page.close();
  }
  const big = [];
  for (const im of imgs) {
    if (!im.src.startsWith('http://beatbots.test')) continue;
    const p = path.join(path.resolve(siteDir), decodeURIComponent(new URL(im.src).pathname));
    if (fs.existsSync(p)) { const kb = fs.statSync(p).size / 1024; if (kb > 400) big.push({ src: im.src, kb: Math.round(kb) }); }
  }
  const report = {
    total: imgs.length,
    broken: imgs.filter(i => !i.ok).map(i => i.src),
    noAlt: imgs.filter(i => !i.alt).map(i => i.src),
    oversizedFiles: big,
    overScaled: imgs.filter(i => i.ok && i.rw > 0 && i.nw / i.rw > 2.5).map(i => ({ src: i.src, natural: i.nw, rendered: i.rw })),
    missing404: [...new Set(missing)],
  };
  await b.close();
  fs.writeFileSync(path.join(outDir, 'img_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ total: report.total, broken: report.broken.length, noAlt: report.noAlt.length, oversized: report.oversizedFiles.length, overScaled: report.overScaled.length, missing404: report.missing404 }));
  process.exit(report.broken.length || report.missing404.length ? 1 : 0);
})();
