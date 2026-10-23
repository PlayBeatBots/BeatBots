// Headless play-test of the BeatMap rhythm battle. Usage: node rhythm_test.cjs <siteDir> <shotDir>
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [siteDir, shotDir] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wav': 'audio/wav' };

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1' }, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.dismiss(); });
  await p.route('http://beatbots.test/**', (r) => {
    const u = new URL(r.request().url());
    const f = path.join(siteDir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://beatbots.test/', { waitUntil: 'load' });
  await p.mouse.click(5, 5);

  const lib = await p.evaluate(() => ({
    options: [...document.querySelectorAll('#arcade-song-select option')].map((o) => o.textContent),
    track01: (() => { const r = new BBRhythm.RhythmEngine({ getEngine: () => null }); return r.loadBeatMap(BBRhythm.LIBRARY[0]); })(),
    bad: (() => { try { BBRhythm.normalizeBeatMap({ bpm: 96, notes: [{ beat: 0, lanes: [5] }] }, 3); return 'accepted?!'; } catch (e) { return e.message; } })(),
  }));
  console.log('library:', lib.options.join(' | '));
  console.log('track01:', JSON.stringify(lib.track01));
  console.log('validation:', lib.bad);

  // ---- perfect bot on Track 01 (one loop + a bit) ----
  const perfect = await p.evaluate(async () => {
    initAudio(); await audioCtx.resume(); await bbEngine.loadKit('bboy');
    document.getElementById('arcade-song-select').value = 'track01';
    document.getElementById('arcade-diff-select').value = 'standard';
    startArcadeGame();
    rhythm.duration = 11; // shorten the round for the test
    const judged = [], offsets = [];
    const pressed = new Set();
    const origHit = rhythm.hit.bind(rhythm);
    rhythm.hit = (lane) => { const r = origHit(lane); if (r) { judged.push(r.judgement); offsets.push(r.offsetMs); } return r; };
    await new Promise((res) => {
      const iv = setInterval(() => {
        const st = rhythm.songTime();
        rhythm.queue.forEach((n) => {
          if (!n.judged && !pressed.has(n.id) && st >= n.time - 0.002) { pressed.add(n.id); checkHit(n.lane); }
        });
        if (!isArcadeRunning) { clearInterval(iv); res(); }
      }, 1);
    });
    const count = (k) => judged.filter((j) => j === k).length;
    return {
      notes: rhythm.stats.notes, hits: rhythm.stats.hits, misses: rhythm.stats.misses,
      perfect: count('perfect'), great: count('great'), good: count('good'),
      meanOffsetMs: Math.round(offsets.reduce((a, b) => a + b, 0) / (offsets.length || 1)),
      grade: document.getElementById('result-grade').textContent, acc: document.getElementById('result-acc').textContent,
      score: document.getElementById('result-score').textContent, clanRestored: bbEngine.clan === activeClanKey,
    };
  });
  console.log('perfect bot:', JSON.stringify(perfect));

  // ---- late press grades lower ----
  const late = await p.evaluate(async () => {
    startArcadeGame(); rhythm.duration = 6;
    const n0 = rhythm.queue[0];
    await new Promise((r) => { const iv = setInterval(() => { if (rhythm.songTime() >= n0.time + 0.07) { clearInterval(iv); r(); } }, 1); });
    const r = rhythm.hit(n0.lane);
    endArcadeGame();
    return { judgement: r && r.judgement, offsetMs: r && r.offsetMs };
  });
  console.log('70ms-late press:', JSON.stringify(late));

  // ---- idle player: notes auto-miss, energy drains ----
  const idle = await p.evaluate(async () => {
    startArcadeGame(); rhythm.duration = 8;
    await new Promise((r) => { const iv = setInterval(() => { if (!isArcadeRunning) { clearInterval(iv); r(); } }, 50); });
    return { misses: rhythm.stats.misses, hp: Math.round(botHP), grade: document.getElementById('result-grade').textContent };
  });
  console.log('idle player:', JSON.stringify(idle));

  // ---- station loop export + mid-game screenshot ----
  const station = await p.evaluate(async () => {
    const bm = exportGridToBeatMap();
    document.getElementById('arcade-song-select').value = 'station';
    startArcadeGame(); rhythm.duration = 6;
    return { title: bm.title, bpm: bm.bpm, notes: bm.notes.length, chords: bm.notes.filter((n) => n.lanes.length > 1).length, queued: rhythm.queue.length };
  });
  console.log('station loop:', JSON.stringify(station));
  await p.evaluate(() => { document.getElementById('arcade-song-select').value = 'track01'; endArcadeGame(); startArcadeGame(); rhythm.duration = 12; });
  await p.waitForTimeout(4200);
  const el = await p.$('#arcade-canvas');
  await el.screenshot({ path: path.join(shotDir, 'arcade_midgame.png') });
  await p.evaluate(() => endArcadeGame());

  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})().catch((e) => { console.error('RHYTHM TEST FAIL:', e.message); process.exit(1); });
