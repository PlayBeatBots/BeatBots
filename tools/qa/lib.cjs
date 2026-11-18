// Shared QA helpers: serve a local site/ dir at http://beatbots.test via Playwright routing.
const fs = require('fs');
const path = require('path');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }

const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain', '.xml': 'application/xml',
};
const BASE = 'http://beatbots.test';

async function launch() {
  const opts = { args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' };
  return pw.chromium.launch(opts);
}

// Route BASE to siteDir. Records local 404s into `missing`.
async function serve(ctxOrPage, siteDir, missing = []) {
  siteDir = path.resolve(siteDir);
  await ctxOrPage.route(BASE + '/**', (route) => {
    const u = new URL(route.request().url());
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let p = path.join(siteDir, rel);
    if (!path.extname(p) && fs.existsSync(p + '.html')) p += '.html'; // Cloudflare Pages pretty URLs (/battle -> battle.html)
    if (!p.startsWith(siteDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      missing.push(rel);
      return route.fulfill({ status: 404, body: '' });
    }
    route.fulfill({ status: 200, contentType: TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(p) });
  });
  return missing;
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.dismiss());
  return errors;
}

function out(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

// Pages the site serves (site/index.html, studio.html, battle.html, mint.html).
const PAGES = (process.env.QA_PAGES || '/,/studio,/battle,/mint').split(',');

const VIEWPORTS = { phone: [375, 812], phoneSmall: [320, 640], tablet: [768, 1024], laptop: [1280, 800], desktop: [1920, 1080] };

module.exports = { launch, serve, watchErrors, out, BASE, VIEWPORTS, PAGES };
