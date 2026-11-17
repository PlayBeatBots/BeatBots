// Headless play-test of the Beat Pad Battle. Usage: node padbattle_test.cjs <siteDir> <outDir> [--render]
// Checks: charts compile, setup + game layout at desktop/phone, a perfect bot wins, an idle player
// loses, no page errors. --render also renders every track offline to <outDir>/<id>.wav + level stats.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [siteDir, outDir, flag] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

async function page(b, vp) {
  const p = await b.newPage({ viewport: vp });
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|cdn\.tailwind|unpkg|net::ERR/.test(m.text())) p.errs.push(m.text()); });
  await p.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'beatbots.test') return r.continue();
    const f = path.join(siteDir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://beatbots.test/', { waitUntil: 'load' });
  return p;
}

// in-page bot: presses each note `offset` s from its time (null = never presses)
const playBot = ({ offsetMs, maxSec }) => new Promise((resolve) => {
  const g = window.BBPadBattle.game;
  g.lastResult = null;
  document.querySelector('#padbattle-root .pb-go').click();
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (g.lastResult && !g.running) { clearInterval(iv); resolve(g.lastResult); return; }
    if ((performance.now() - t0) / 1000 > maxSec) { clearInterval(iv); resolve({ timeout: true, tug: g.tug, counts: g.counts }); return; }
    if (!g.running || offsetMs == null) return;
    const songT = g.audio.ctx.currentTime - g.startAt - g.lat;
    for (let i = g.ni; i < g.notes.length; i++) {
      const n = g.notes[i];
      if (n.t > songT + 0.05) break;
      if (!n.j && !n.botDone && songT >= n.t + offsetMs / 1000) { n.botDone = true; g.press(n.pad); }
    }
  }, 2);
});

(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'beatbots.test' } : undefined, args: ['--autoplay-policy=no-user-gesture-required'] });

  // charts
  const p = await page(b, { width: 1440, height: 1000 });
  const charts = await p.evaluate(() => window.BBPadBattle.SONGS.flatMap((s) => Object.keys(window.BBPadBattle.DIFFS).map((d) => {
    try { const c = window.BBPadBattle.compile(s, d); return { id: s.id, d, ok: true, notes: c.player.length, secs: Math.round(c.total) }; } catch (e) { return { id: s.id, d, ok: false, err: e.message }; }
  })));
  charts.forEach((c) => check(c.ok && c.notes > 20, `chart ${c.id}/${c.d}: ${c.ok ? `${c.notes} notes, ${c.secs}s` : c.err}`));

  // first visit shows How to play; Got it leads to setup
  await p.locator('#arcade-section').scrollIntoViewIfNeeded();
  check(await p.locator('#padbattle-root .pb-steps li').count() === 4, 'first visit shows the 4-step How to play');
  await p.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'howto-desktop.png') });
  await p.locator('#padbattle-root .pb-got').click();

  // setup screen
  await p.locator('#arcade-section').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await p.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'setup-desktop.png') });
  check(await p.locator('#padbattle-root .pb-card').count() === 5, 'setup shows 5 clan bots');

  // perfect run (standard, B-Boy)
  await p.evaluate(() => { const s = window.BBPadBattle.game.setup; s.clan = 'bboy'; s.song = 'brooklyn-cypher'; s.diff = 'standard'; s.bt = false; window.BBPadBattle.game.showSetup(); });
  const shot = p.evaluate(() => new Promise((r) => setTimeout(r, 9000)));
  const perfect = p.evaluate(playBot, { offsetMs: 0, maxSec: 80 });
  await shot;
  await p.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'game-desktop.png') });
  const chips = await p.evaluate(() => [...document.querySelectorAll('#padbattle-root .pb-cue .c')].filter((c) => c.style.display !== 'none').map((c) => c.textContent));
  check(chips.length > 0 && chips.every((t) => /^[ASDF]+$/.test(t)), `cue strip shows key letters (${chips.slice(0, 6).join(' ')})`);
  const pr = await perfect;
  console.log('perfect run:', JSON.stringify(pr));
  check(pr.win && pr.counts.miss === 0 && pr.acc >= 99, 'perfect bot wins with no misses');
  await p.waitForTimeout(600);
  await p.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'result-desktop.png') });

  // Easy: only A + S charted
  await p.evaluate(() => { const g = window.BBPadBattle.game; g.showSetup(); g.setup.diff = 'easy'; g.setup.song = 'golden-hour'; g.setup.clan = 'alchemist'; g.showSetup(); });
  const easy = await p.evaluate(playBot, { offsetMs: 0, maxSec: 85 });
  const easyPads = await p.evaluate(() => [...new Set(window.BBPadBattle.game.notes.map((n) => n.pad))]);
  console.log('easy run:', JSON.stringify(easy), 'pads', easyPads);
  check(easy.win && easyPads.every((x) => x === 8 || x === 9), 'Easy uses only A + S and a perfect run wins');

  // 60 ms late every note: should still land (GOOD/GREAT), fewer perfects
  await p.evaluate(() => window.BBPadBattle.game.showSetup());
  await p.evaluate(() => { window.BBPadBattle.game.setup.diff = 'turbo'; window.BBPadBattle.game.setup.song = 'steel-foundry'; window.BBPadBattle.game.setup.clan = 'industrial'; window.BBPadBattle.game.showSetup(); });
  const late = await p.evaluate(playBot, { offsetMs: 70, maxSec: 80 });
  console.log('70ms-late run:', JSON.stringify(late));
  check(!late.timeout && late.counts.miss <= 2 && late.counts.perfect === 0, 'late hits judged GREAT/GOOD, not PERFECT, not MISS');

  // idle run loses
  await p.evaluate(() => { window.BBPadBattle.game.setup.diff = 'standard'; window.BBPadBattle.game.setup.song = 'double-bins'; window.BBPadBattle.game.showSetup(); });
  const idle = await p.evaluate(playBot, { offsetMs: null, maxSec: 90 });
  console.log('idle run:', JSON.stringify(idle));
  check(!idle.win, 'idle player loses');
  check(p.errs.length === 0, `no page errors on desktop${p.errs.length ? ': ' + p.errs.slice(0, 3).join(' | ') : ''}`);

  // phone layout
  const m = await page(b, { width: 390, height: 844 });
  await m.locator('#arcade-section').scrollIntoViewIfNeeded();
  await m.waitForTimeout(300);
  await m.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'howto-phone.png') });
  await m.locator('#padbattle-root .pb-got').click();
  await m.waitForTimeout(400);
  await m.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'setup-phone.png') });
  const ov = await m.evaluate(() => { const r = document.querySelector('#padbattle-root .pb').getBoundingClientRect(); const wide = [...document.querySelectorAll('#padbattle-root *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length; return { w: r.width, left: r.left, right: r.right, wide }; });
  check(ov.left >= 0 && ov.right <= 390 && ov.wide === 0, `phone: game fits the screen (${Math.round(ov.w)}px wide, ${ov.wide} elements past the edge)`);
  const mp = m.evaluate(playBot, { offsetMs: 0, maxSec: 12 });
  await m.waitForTimeout(8000);
  await m.locator('#padbattle-root').screenshot({ path: path.join(outDir, 'game-phone.png') });
  const padSize = await m.evaluate(() => document.querySelector('.pb-pad').getBoundingClientRect().width);
  check(padSize >= 56, `phone pad tap target ${Math.round(padSize)}px`);
  await mp;
  await m.evaluate(() => window.BBPadBattle.game.end('quit'));
  check(m.errs.length === 0, `no page errors on phone${m.errs.length ? ': ' + m.errs.slice(0, 3).join(' | ') : ''}`);

  if (flag === '--render') {
    const ids = await p.evaluate(() => window.BBPadBattle.SONGS.map((s) => s.id));
    for (const id of ids) {
      const r = await p.evaluate(async (id) => {
        const buf = await window.BBPadBattle.renderSong(id, { diff: 'hyper' });
        const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
        let peak = 0, sum = 0;
        const pcm = new Int16Array(n * 2);
        for (let i = 0; i < n; i++) {
          const a = L[i], c = R[i];
          peak = Math.max(peak, Math.abs(a), Math.abs(c)); sum += a * a + c * c;
          pcm[2 * i] = Math.max(-1, Math.min(1, a)) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, c)) * 32767;
        }
        const bytes = new Uint8Array(pcm.buffer); let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { sr: buf.sampleRate, peakDb: 20 * Math.log10(peak), rmsDb: 10 * Math.log10(sum / (2 * n)), b64: btoa(s) };
      }, id);
      const raw = Buffer.from(r.b64, 'base64');
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + raw.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16);
      hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(r.sr, 24); hdr.writeUInt32LE(r.sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
      hdr.write('data', 36); hdr.writeUInt32LE(raw.length, 40);
      fs.writeFileSync(path.join(outDir, `${id}.wav`), Buffer.concat([hdr, raw]));
      console.log(`render ${id}: peak ${r.peakDb.toFixed(1)} dBFS, rms ${r.rmsDb.toFixed(1)} dBFS`);
      check(r.peakDb < 0 && r.rmsDb > -24, `render ${id} levels sane`);
    }
  }
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
