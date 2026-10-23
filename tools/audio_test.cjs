// Headless audio QA for the BeatBots site.
// Usage: node audio_test.cjs <siteDir> <outDir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const [siteDir, outDir] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'application/javascript' };

(async () => {
  const browser = await chromium.launch({
    proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' },
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.dismiss());
  await page.route('http://beatbots.test/**', (route) => {
    const u = new URL(route.request().url());
    const p = path.join(siteDir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!p.startsWith(siteDir) || !fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: types[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });
  });
  await page.goto('http://beatbots.test/', { waitUntil: 'load' });
  await page.mouse.click(5, 5); // user gesture -> unlocks audio

  // 1. Live engine: call every voice / model / FX / preset / UI sound
  const live = await page.evaluate(async () => {
    const fails = [];
    const tryIt = (label, fn) => { try { fn(); } catch (e) { fails.push(`${label}: ${e.message}`); } };
    initAudio();
    await audioCtx.resume();
    const models = {
      0: ['sub', 'punch', 'hard'], 1: ['crisp', 'clap', 'rim'], 2: ['closed', 'open', 'shaker'],
      3: ['cowbell', 'bongo', 'wood'], 4: ['sine', 'reese', 'acid'], 5: ['soul', 'saw', 'flute'],
      6: ['hey', 'yeah', 'drop'], 7: ['tom', 'laser', 'whoosh'],
    };
    for (const [tr, ms] of Object.entries(models)) for (const m of ms) tryIt(`track ${tr}/${m}`, () => bbEngine.playTrack(+tr, 0, m, 0));
    for (const fx of ['siren', 'sub', 'scratch', 'laser', 'stop', 'riser', 'airhorn', 'amen', 'metal', 'gong']) tryIt(`fx ${fx}`, () => triggerFX(fx));
    for (const p of ['vocoder', 'wobble', 'rhodes', 'industrial', 'gong']) {
      document.getElementById('synth-lab-preset').value = p;
      tryIt(`key ${p}`, () => playKeyboardNote(220));
    }
    for (const u of ['click', 'on', 'off', 'step', 'servo', 'hit', 'miss', 'chime']) tryIt(`ui ${u}`, () => bbEngine.ui(u, { combo: 12 }));
    for (const c of ['bboy', 'dub', 'alchemist', 'industrial', 'biomech']) tryIt(`clan ${c}`, () => selectClan(c));
    for (const id of ['toggle-delay-btn', 'toggle-dist-btn', 'toggle-saturation-btn']) tryIt(`toggle ${id}`, () => document.getElementById(id).click());
    const fs = document.getElementById('filter-slider');
    fs.value = 40; fs.dispatchEvent(new Event('input'));
    const filterLabel = document.getElementById('filter-val').textContent;
    fs.value = 100; fs.dispatchEvent(new Event('input'));
    // put toggles back to defaults
    for (const id of ['toggle-delay-btn', 'toggle-dist-btn', 'toggle-saturation-btn']) document.getElementById(id).click();
    return { fails, state: audioCtx.state, filterLabel, engineState: bbEngine.state, clan: bbEngine.clan };
  });

  // 2. Sequencer clock: record scheduled note times for ~1.5 s
  const seq = await page.evaluate(async () => {
    selectClan('bboy');
    const times = [];
    const orig = bbEngine.playTrack;
    bbEngine.playTrack = (tr, time, model, step) => { if (tr === 2) times.push([step, time]); return orig(tr, time, model, step); };
    bpm = 120; swingPercent = 30;
    document.getElementById('seq-play-btn').click();
    await new Promise((r) => setTimeout(r, 1500));
    const highlighted = document.querySelectorAll('.step-current').length;
    document.getElementById('seq-play-btn').click();
    bbEngine.playTrack = orig;
    return { times, highlighted, playing: isSeqPlaying };
  });

  // 3. Offline measurements per voice
  const stats = await page.evaluate(async () => {
    const out = [];
    const one = (tr, m) => {
      const pat = Array.from({ length: 8 }, () => Array(16).fill(0));
      pat[tr][0] = 1;
      const models = ['sub', 'crisp', 'closed', 'cowbell', 'sine', 'soul', 'hey', 'tom'];
      models[tr] = m;
      return BBAudio.renderPattern({ pattern: pat, models, bpm: 120, swing: 0, clan: 'bboy', bars: 1, settings: {} });
    };
    const measure = (buf) => {
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, clipped = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); sum += d[i] * d[i]; if (a >= 0.999) clipped++; }
      return { peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(sum / d.length + 1e-12)).toFixed(1), clipped };
    };
    const zcHz = (d, sr, a, b) => {
      let z = 0; for (let i = Math.floor(a * sr) + 1; i < Math.floor(b * sr); i++) if ((d[i - 1] <= 0) !== (d[i] <= 0)) z++;
      return Math.round(z / 2 / (b - a));
    };
    const models = { 0: ['sub', 'punch', 'hard'], 1: ['crisp', 'clap', 'rim'], 2: ['closed', 'open', 'shaker'], 3: ['cowbell', 'bongo', 'wood'], 4: ['sine', 'reese', 'acid'], 5: ['soul', 'saw', 'flute'], 6: ['hey', 'yeah', 'drop'], 7: ['tom', 'laser', 'whoosh'] };
    for (const [tr, ms] of Object.entries(models)) {
      for (const m of ms) {
        const buf = await one(+tr, m);
        const r = Object.assign({ voice: `${tr}:${m}` }, measure(buf));
        if (+tr === 0) {
          const d = buf.getChannelData(0);
          r.pitchEarly = zcHz(d, buf.sampleRate, 0.004, 0.02);
          r.pitchLate = zcHz(d, buf.sampleRate, 0.1, 0.2);
        }
        out.push(r);
      }
    }
    return out;
  });

  // 4. Demo loops: each clan preset, 4 bars at its own tempo
  const demos = await page.evaluate(async () => {
    const PRESET_TEMPOS = { bboy: 96, dub: 140, soul: 90, metal: 105, poly: 138 };
    const res = {};
    const plan = {
      bboy: { clan: 'bboy', models: ['punch', 'crisp', 'closed', 'cowbell', 'sine', 'soul', 'hey', 'tom'] },
      dub: { clan: 'dub', models: ['sub', 'rim', 'open', 'wood', 'reese', 'flute', 'drop', 'laser'] },
      soul: { clan: 'alchemist', models: ['sub', 'clap', 'shaker', 'bongo', 'sine', 'soul', 'yeah', 'whoosh'] },
      metal: { clan: 'industrial', models: ['hard', 'crisp', 'closed', 'cowbell', 'acid', 'saw', 'hey', 'laser'] },
      poly: { clan: 'biomech', models: ['sub', 'rim', 'closed', 'bongo', 'reese', 'flute', 'drop', 'tom'] },
    };
    for (const [key, p] of Object.entries(plan)) {
      const buf = await BBAudio.renderPattern({
        pattern: PRESETS[key], models: p.models, bpm: PRESET_TEMPOS[key] || 105, swing: key === 'bboy' ? 22 : 10,
        clan: p.clan, bars: 4, settings: { tapeOn: true, delayOn: true, driveOn: key === 'metal', drive: 35 },
      });
      const blob = BBAudio.bufferToWav(buf);
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      let peak = 0; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      res[key] = { b64, bpm: PRESET_TEMPOS[key], peak: +peak.toFixed(3), secs: +(buf.length / buf.sampleRate).toFixed(2) };
    }
    return res;
  });

  console.log(JSON.stringify({ live, seq: { notes: seq.times.length, first: seq.times.slice(0, 8), highlighted: seq.highlighted, stoppedClean: !seq.playing }, stats }, null, 1));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [k, v] of Object.entries(demos)) {
    fs.writeFileSync(path.join(outDir, `beatbots_${k}_${v.bpm}bpm.wav`), Buffer.from(v.b64, 'base64'));
    console.log(`demo ${k}: ${v.secs}s peak ${v.peak}`);
  }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('AUDIO TEST FAIL:', e.message); process.exit(1); });
