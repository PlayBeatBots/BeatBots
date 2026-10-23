/*
 * BeatBots Audio Engine v4 — procedural synthesis on the Web Audio API.
 *
 * window.BBAudio.createEngine(ctx, opts) -> engine
 *   Works with a live AudioContext or an OfflineAudioContext (used for WAV export).
 *
 * Signal flow:
 *   voices ─┬─────────────► in ─► highpass ─► lowpass ─► clan EQ (low/mid/high)
 *           ├─► reverb send ─► convolver ──┘          ─► drive ─► tape ─► glue comp
 *           └─► delay send ─► delay ⇄ (filtered feedback) ┘        ─► master ─► limiter ─► out
 *   UI sounds ─► uiBus ─────────────────────────────────────────────────────────┘
 */
(function () {
  'use strict';

  const TINY = 0.0001;
  const NOISE = new WeakMap();
  const IMPULSE = new WeakMap();

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function noiseBuffer(ctx) {
    let b = NOISE.get(ctx);
    if (!b) {
      const len = Math.floor(ctx.sampleRate * 2);
      b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      NOISE.set(ctx, b);
    }
    return b;
  }

  // Stereo room impulse: decaying noise, darkened with a one-pole lowpass
  function impulse(ctx) {
    let b = IMPULSE.get(ctx);
    if (!b) {
      const secs = 2.6;
      const len = Math.floor(ctx.sampleRate * secs);
      b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const x = i / len;
          const env = Math.pow(1 - x, 3.2) * (i < 220 ? i / 220 : 1);
          lp += 0.42 * ((Math.random() * 2 - 1) - lp);
          d[i] = lp * env;
        }
      }
      IMPULSE.set(ctx, b);
    }
    return b;
  }

  // tanh saturation curve, normalised so ±1 maps to ±1
  function satCurve(k) {
    const n = 2048;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    return c;
  }

  // Sound Clan voicings: tone EQ, space, and musical key
  const CLANS = {
    bboy: {
      low: [100, 2], mid: [1600, 1.5, 0.8], high: [10000, -1.5],
      rev: 0.16, dly: 0.12, fb: 0.30, dlyLP: 3200, color: 0.8,
      root: 33, // A1
      bass: [0, 0, 12, 0, 0, 0, 10, 0, 0, 7, 0, 0, 3, 0, 5, 0],
      chords: [[57, 60, 64, 67], [62, 65, 69, 72]],
    },
    dub: {
      low: [70, 4], mid: [420, -1.5, 0.7], high: [6500, -3],
      rev: 0.24, dly: 0.30, fb: 0.55, dlyLP: 1800, color: 1.0,
      root: 31, // G1
      bass: [0, 0, 0, 7, 0, 0, 0, 0, 10, 10, 0, 0, 0, 7, 5, 0],
      chords: [[55, 58, 62, 65], [53, 57, 60, 63]],
    },
    alchemist: {
      low: [120, 1], mid: [2500, 1.5, 0.7], high: [8000, 3],
      rev: 0.32, dly: 0.18, fb: 0.40, dlyLP: 6000, color: 0.5,
      root: 29, // F1
      bass: [0, 0, 7, 0, 0, 12, 0, 0, 5, 0, 7, 0, 0, 10, 0, 0],
      chords: [[65, 69, 72, 76], [64, 67, 71, 74]],
    },
    industrial: {
      low: [90, 2.5], mid: [1800, 3, 1.0], high: [7000, 1],
      rev: 0.12, dly: 0.08, fb: 0.25, dlyLP: 4000, color: 2.2,
      root: 26, // D1
      bass: [0, 0, 12, 0, 0, 1, 0, 0, 0, 0, 12, 0, 0, 1, 0, 3],
      chords: [[50, 57, 62], [51, 58, 63]],
    },
    biomech: {
      low: [80, 2], mid: [450, 2, 1.2], high: [7500, -2],
      rev: 0.40, dly: 0.16, fb: 0.45, dlyLP: 2500, color: 1.2,
      root: 26, // D1
      bass: [0, 0, 3, 0, 5, 0, 3, 0, 0, 7, 0, 5, 3, 0, 1, 0],
      chords: [[62, 65, 69, 76], [58, 62, 65, 69]],
    },
  };

  function createEngine(ctx, opts) {
    opts = opts || {};
    const E = {
      ctx,
      clan: 'bboy',
      bpm: 105,
      state: { drive: 15, driveOn: false, tapeOn: true, delayOn: true, delayTime: 0.28, hp: 30, lp: 20000 },
      nodes: {},
    };
    const N = E.nodes;
    const now = () => ctx.currentTime;

    // ---------- bus ----------
    N.in = ctx.createGain();
    N.highpass = ctx.createBiquadFilter(); N.highpass.type = 'highpass'; N.highpass.frequency.value = 30; N.highpass.Q.value = 0.5;
    N.lowpass = ctx.createBiquadFilter(); N.lowpass.type = 'lowpass'; N.lowpass.frequency.value = 20000; N.lowpass.Q.value = 0.6;
    N.eqLow = ctx.createBiquadFilter(); N.eqLow.type = 'lowshelf';
    N.eqMid = ctx.createBiquadFilter(); N.eqMid.type = 'peaking';
    N.eqHigh = ctx.createBiquadFilter(); N.eqHigh.type = 'highshelf';
    N.drive = ctx.createWaveShaper(); N.drive.oversample = '4x';
    N.driveTrim = ctx.createGain();
    N.tape = ctx.createWaveShaper(); N.tape.oversample = '2x';
    N.glue = ctx.createDynamicsCompressor();
    N.glue.threshold.value = -16; N.glue.ratio.value = 3; N.glue.knee.value = 8; N.glue.attack.value = 0.012; N.glue.release.value = 0.18;
    N.master = ctx.createGain(); N.master.gain.value = opts.masterGain != null ? opts.masterGain : 0.9;
    N.limiter = ctx.createDynamicsCompressor();
    N.limiter.threshold.value = -2.5; N.limiter.ratio.value = 20; N.limiter.knee.value = 0; N.limiter.attack.value = 0.002; N.limiter.release.value = 0.08;

    N.in.connect(N.highpass); N.highpass.connect(N.lowpass); N.lowpass.connect(N.eqLow);
    N.eqLow.connect(N.eqMid); N.eqMid.connect(N.eqHigh); N.eqHigh.connect(N.drive);
    N.drive.connect(N.driveTrim); N.driveTrim.connect(N.tape); N.tape.connect(N.glue);
    N.glue.connect(N.master); N.master.connect(N.limiter);
    N.limiter.connect(opts.destination || ctx.destination);

    // ---------- reverb send ----------
    N.revIn = ctx.createGain();
    N.revPre = ctx.createBiquadFilter(); N.revPre.type = 'highpass'; N.revPre.frequency.value = 220;
    N.reverb = ctx.createConvolver(); N.reverb.buffer = impulse(ctx);
    N.revRet = ctx.createGain(); N.revRet.gain.value = 0.16;
    N.revIn.connect(N.revPre); N.revPre.connect(N.reverb); N.reverb.connect(N.revRet); N.revRet.connect(N.in);

    // ---------- dub delay send (feedback is filtered, so repeats darken) ----------
    N.dlyIn = ctx.createGain();
    N.delay = ctx.createDelay(2.0); N.delay.delayTime.value = 0.28;
    N.dlyLP = ctx.createBiquadFilter(); N.dlyLP.type = 'lowpass'; N.dlyLP.frequency.value = 3200;
    N.dlyHP = ctx.createBiquadFilter(); N.dlyHP.type = 'highpass'; N.dlyHP.frequency.value = 180;
    N.dlyFb = ctx.createGain(); N.dlyFb.gain.value = 0.3;
    N.dlyRet = ctx.createGain(); N.dlyRet.gain.value = 0.55;
    N.dlyIn.connect(N.delay); N.delay.connect(N.dlyLP); N.dlyLP.connect(N.dlyHP);
    N.dlyHP.connect(N.dlyFb); N.dlyFb.connect(N.delay); N.dlyHP.connect(N.dlyRet); N.dlyRet.connect(N.in);

    // ---------- UI sounds bypass the music chain ----------
    N.uiBus = ctx.createGain(); N.uiBus.gain.value = opts.uiGain != null ? opts.uiGain : 0.32;
    N.uiBus.connect(N.limiter);

    // ---------- helpers ----------
    function osc(type, f, t) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      return o;
    }
    function gainNode(v) { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; }
    function filt(type, f, q, t) {
      const b = ctx.createBiquadFilter();
      b.type = type; b.frequency.setValueAtTime(f, t || now());
      if (q != null) b.Q.setValueAtTime(q, t || now());
      return b;
    }
    function noise(t, dur) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(ctx);
      s.start(t, Math.random() * 1.2, dur + 0.05);
      return s;
    }
    // percussive envelope: tiny attack, exponential decay
    function perc(g, t, peak, decay, attack) {
      attack = attack || 0.0015;
      g.gain.setValueAtTime(TINY, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(TINY, t + attack + decay);
    }
    // held envelope: attack, sustain, release
    function hold(g, t, peak, attack, dur, release) {
      g.gain.setValueAtTime(TINY, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + Math.max(attack, dur));
      g.gain.exponentialRampToValueAtTime(TINY, t + Math.max(attack, dur) + release);
    }
    function stopAll(nodes, t) { nodes.forEach((n) => n.stop(t)); }
    // route a voice into the mix with optional reverb/delay sends
    function route(node, o) {
      o = o || {};
      const out = gainNode(o.gain == null ? 1 : o.gain);
      node.connect(out); out.connect(N.in);
      const c = CLANS[E.clan] || CLANS.bboy;
      const rev = (o.rev || 0) * (o.clanSpace === false ? 1 : 0.6 + c.rev * 1.5);
      if (rev > 0) { const s = gainNode(rev); out.connect(s); s.connect(N.revIn); }
      const dly = (o.dly || 0) * (o.clanSpace === false ? 1 : 0.6 + c.dly * 1.5);
      if (dly > 0) { const s = gainNode(dly); out.connect(s); s.connect(N.dlyIn); }
      return out;
    }
    function shaper(k) { const w = ctx.createWaveShaper(); w.curve = satCurve(k); w.oversample = '2x'; return w; }
    const T = (t) => t || now();
    const stepSec = () => 60 / E.bpm / 4;

    // ---------- sampler: per-clan kits (kits/<clan>/kit.json) ----------
    E.kits = {};          // clan -> { manifest, buffers }
    E.kitBase = null;     // e.g. 'kits/' — set by the page; null = synth only
    const kitLoads = {};
    E.loadKit = (clan) => {
      if (!E.kitBase || !CLANS[clan]) return Promise.resolve(null);
      if (E.kits[clan]) return Promise.resolve(E.kits[clan]);
      if (kitLoads[clan]) return kitLoads[clan];
      const base = `${E.kitBase}${clan}/`;
      kitLoads[clan] = fetch(base + 'kit.json')
        .then((r) => { if (!r.ok) throw new Error(`kit ${clan}: HTTP ${r.status}`); return r.json(); })
        .then(async (manifest) => {
          const files = new Set();
          const collect = (e) => { if (!e) return; if (e.multi) e.multi.forEach(collect); else if (e.file) files.add(e.file); };
          Object.values(manifest.tracks || {}).forEach((models) => Object.values(models).forEach(collect));
          Object.values(manifest.fx || {}).forEach(collect);
          const buffers = {};
          await Promise.all([...files].map(async (f) => {
            const ab = await (await fetch(base + f)).arrayBuffer();
            buffers[f] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
          }));
          E.kits[clan] = { manifest, buffers };
          return E.kits[clan];
        })
        .catch((err) => { console.warn('BeatBots kit load failed, using synth:', err); delete kitLoads[clan]; return null; });
      return kitLoads[clan];
    };
    E.useKit = (clan, kit) => { if (kit) E.kits[clan] = kit; };
    const kitEntry = (track, model) => {
      const k = E.kits[E.clan];
      const m = k && k.manifest.tracks && k.manifest.tracks[String(track)];
      return m && m[model] ? { kit: k, entry: m[model] } : null;
    };
    const kitFx = (type) => {
      const k = E.kits[E.clan];
      return k && k.manifest.fx && k.manifest.fx[type] ? { kit: k, entry: k.manifest.fx[type] } : null;
    };
    // per-track mix level and space for samples (samples are peak-normalised to -1 dBFS)
    const SAMPLE_MIX = {
      0: { gain: 0.92, rev: 0 }, 1: { gain: 0.62, rev: 0.18 }, 2: { gain: 0.34, rev: 0.05 },
      3: { gain: 0.42, rev: 0.12 }, 4: { gain: 0.8, rev: 0 }, 5: { gain: 0.2, rev: 0.25, dly: 0.1 },
      6: { gain: 0.5, rev: 0.2 }, 7: { gain: 0.55, rev: 0.22 },
    };
    function playBuffer(buf, t, o) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(o.rate || 1, t);
      const g = gainNode(0);
      const peak = (o.gain == null ? 1 : o.gain) * (o.vel || 1);
      g.gain.setValueAtTime(peak, t);
      const natural = buf.duration / (o.rate || 1);
      if (o.dur && o.dur < natural) {
        g.gain.setValueAtTime(peak, t + o.dur);
        g.gain.exponentialRampToValueAtTime(TINY, t + o.dur + (o.release || 0.05));
      }
      src.connect(g);
      route(g, { gain: 1, rev: o.rev || 0, dly: o.dly || 0 });
      src.start(t);
      src.stop(t + Math.min(natural, (o.dur || natural) + (o.release || 0.05)) + 0.02);
    }
    // returns true if a sample handled this hit
    function playSampleTrack(track, model, t, o) {
      const hit = kitEntry(track, model);
      if (!hit) return false;
      const { kit, entry } = hit;
      const mix = SAMPLE_MIX[track] || { gain: 0.6 };
      const c = CLANS[E.clan] || CLANS.bboy;
      if (track === 4 && entry.file) { // pitched bass follows the clan bassline
        const buf = kit.buffers[entry.file]; if (!buf) return false;
        const semis = o.step != null ? c.bass[o.step % 16] : 0;
        const target = c.root + semis;
        const rate = Math.pow(2, (target - (entry.root || target)) / 12);
        playBuffer(buf, t, { gain: mix.gain, rate, vel: o.vel, dur: o.dur || stepSec() * 1.7, release: 0.06 });
        return true;
      }
      if (track === 5 && entry.multi) { // chord from multisampled keys
        const notes = c.chords[(o.step || 0) < 8 ? 0 : 1];
        const dur = o.dur || stepSec() * 2.5;
        notes.forEach((m) => {
          let best = entry.multi[0];
          entry.multi.forEach((z) => { if (Math.abs(z.root - m) < Math.abs(best.root - m)) best = z; });
          const buf = kit.buffers[best.file]; if (!buf) return;
          playBuffer(buf, t, { gain: mix.gain, rate: Math.pow(2, (m - best.root) / 12), vel: o.vel, dur, release: 0.35, rev: mix.rev, dly: mix.dly });
        });
        return true;
      }
      const buf = kit.buffers[entry.file]; if (!buf) return false;
      playBuffer(buf, t, { gain: mix.gain * (entry.gain || 1), vel: o.vel, rev: mix.rev, dly: mix.dly });
      return true;
    }

    // ---------- controls ----------
    function ramp(param, v, t) { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.06); }
    E.setHighpass = (hz) => { E.state.hp = hz; ramp(N.highpass.frequency, hz, now()); };
    E.setLowpass = (hz) => { E.state.lp = hz; ramp(N.lowpass.frequency, hz, now()); };
    E.setDelayTime = (s) => { E.state.delayTime = s; ramp(N.delay.delayTime, s, now()); };
    E.setDelayOn = (on) => { E.state.delayOn = on; ramp(N.dlyRet.gain, on ? 0.55 : 0, now()); };
    E.setTempo = (bpm) => { E.bpm = bpm; };
    E.setDrive = (on, amount) => {
      E.state.driveOn = on; if (amount != null) E.state.drive = amount;
      if (!on || E.state.drive <= 0) { N.drive.curve = null; N.driveTrim.gain.value = 1; return; }
      const k = 1 + E.state.drive / 9;
      N.drive.curve = satCurve(k);
      N.driveTrim.gain.value = 1 / (1 + E.state.drive / 140);
    };
    function updateTape() {
      const c = CLANS[E.clan] || CLANS.bboy;
      N.tape.curve = E.state.tapeOn ? satCurve(1.05 + c.color * 0.35) : null;
    }
    E.setTape = (on) => { E.state.tapeOn = on; updateTape(); };
    E.setClan = (key) => {
      const c = CLANS[key]; if (!c) return;
      E.clan = key;
      E.loadKit(key);
      const t = now();
      ramp(N.eqLow.frequency, c.low[0], t); ramp(N.eqLow.gain, c.low[1], t);
      ramp(N.eqMid.frequency, c.mid[0], t); ramp(N.eqMid.gain, c.mid[1], t); ramp(N.eqMid.Q, c.mid[2], t);
      ramp(N.eqHigh.frequency, c.high[0], t); ramp(N.eqHigh.gain, c.high[1], t);
      ramp(N.revRet.gain, c.rev, t);
      ramp(N.dlyFb.gain, c.fb, t);
      ramp(N.dlyLP.frequency, c.dlyLP, t);
      updateTape();
    };
    E.clans = CLANS;

    // =====================================================================
    // DRUMS
    // =====================================================================
    E.kick = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      const m = {
        sub:   { f0: 150, f1: 42, pd: 0.075, dec: 0.55, click: 0.35, k: 0 },
        punch: { f0: 190, f1: 52, pd: 0.045, dec: 0.30, click: 0.75, k: 1.6 },
        hard:  { f0: 175, f1: 40, pd: 0.060, dec: 0.42, click: 0.95, k: 3.2 },
      }[model] || { f0: 150, f1: 42, pd: 0.075, dec: 0.55, click: 0.35, k: 0 };

      const body = osc('sine', m.f0, t);
      body.frequency.exponentialRampToValueAtTime(m.f1, t + m.pd);
      body.frequency.exponentialRampToValueAtTime(m.f1 * 0.9, t + m.dec);
      const bg = gainNode(0);
      perc(bg, t, 1.0 * vel, m.dec, 0.002);
      let chain = body;
      if (m.k > 0) { const s = shaper(m.k); body.connect(s); chain = s; }
      chain.connect(bg);

      // beater click: short filtered noise + pitched tick
      const n = noise(t, 0.02);
      const nb = filt('bandpass', 4200, 0.9, t);
      const ng = gainNode(0); perc(ng, t, m.click * 0.55 * vel, 0.012, 0.0005);
      n.connect(nb); nb.connect(ng);
      const tick = osc('square', 1900, t); tick.frequency.exponentialRampToValueAtTime(380, t + 0.008);
      const tg = gainNode(0); perc(tg, t, m.click * 0.18 * vel, 0.009, 0.0005);
      tick.connect(tg);

      const mix = gainNode(1); bg.connect(mix); ng.connect(mix); tg.connect(mix);
      route(mix, { gain: 0.95 });
      body.start(t); tick.start(t);
      stopAll([body], t + m.dec + 0.05); tick.stop(t + 0.02);
    };

    E.snare = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      const mix = gainNode(1);
      if (model === 'clap') {
        const n = noise(t, 0.25);
        const bp = filt('bandpass', 1150, 1.1, t);
        const hp = filt('highpass', 600, 0.7, t);
        const g = gainNode(0);
        // three tight spikes, then the room tail
        g.gain.setValueAtTime(TINY, t);
        [0, 0.011, 0.022].forEach((d, i) => {
          g.gain.linearRampToValueAtTime(0.9 * vel * (1 - i * 0.1), t + d + 0.001);
          g.gain.exponentialRampToValueAtTime(0.12 * vel, t + d + 0.009);
        });
        g.gain.linearRampToValueAtTime(0.75 * vel, t + 0.032);
        g.gain.exponentialRampToValueAtTime(TINY, t + 0.2);
        n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(mix);
        route(mix, { gain: 0.8, rev: 0.22 });
        return;
      }
      if (model === 'rim') {
        const a = osc('triangle', 470, t); const ag = gainNode(0); perc(ag, t, 0.55 * vel, 0.035);
        const b = osc('sine', 1700, t); const bg = gainNode(0); perc(bg, t, 0.3 * vel, 0.018);
        const n = noise(t, 0.02); const nb = filt('bandpass', 3000, 2, t); const ng = gainNode(0); perc(ng, t, 0.35 * vel, 0.012, 0.0005);
        a.connect(ag); b.connect(bg); n.connect(nb); nb.connect(ng);
        [ag, bg, ng].forEach((x) => x.connect(mix));
        route(mix, { gain: 0.8, rev: 0.12 });
        a.start(t); b.start(t); a.stop(t + 0.06); b.stop(t + 0.04);
        return;
      }
      // 'crisp': two tuned body oscillators + shaped, high-passed noise
      const b1 = osc('triangle', 190, t); b1.frequency.exponentialRampToValueAtTime(162, t + 0.08);
      const b2 = osc('sine', 335, t); b2.frequency.exponentialRampToValueAtTime(300, t + 0.06);
      const g1 = gainNode(0); perc(g1, t, 0.55 * vel, 0.11);
      const g2 = gainNode(0); perc(g2, t, 0.32 * vel, 0.07);
      b1.connect(g1); b2.connect(g2);
      const n = noise(t, 0.3);
      const hp = filt('highpass', 1400, 0.7, t);
      const pk = filt('peaking', 5200, 0.9, t); pk.gain.setValueAtTime(5, t);
      const ng = gainNode(0); perc(ng, t, 0.62 * vel, 0.2, 0.001);
      n.connect(hp); hp.connect(pk); pk.connect(ng);
      [g1, g2, ng].forEach((x) => x.connect(mix));
      route(mix, { gain: 0.85, rev: 0.18 });
      b1.start(t); b2.start(t); b1.stop(t + 0.15); b2.stop(t + 0.1);
    };

    // TR-808-style metallic hats: six inharmonic square oscillators
    const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
    E.hat = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      if (model === 'shaker') {
        const n = noise(t, 0.12);
        const bp = filt('bandpass', 6500, 1.4, t);
        const g = gainNode(0);
        g.gain.setValueAtTime(TINY, t);
        g.gain.linearRampToValueAtTime(0.38 * vel, t + 0.018);
        g.gain.exponentialRampToValueAtTime(TINY, t + 0.09);
        n.connect(bp); bp.connect(g);
        route(g, { gain: 0.8, rev: 0.06 });
        return;
      }
      const open = model === 'open';
      const dec = open ? 0.34 : 0.045;
      const sum = gainNode(1.0);
      const oscs = HAT_RATIOS.map((r) => { const s = osc('square', 40 * r, t); s.connect(sum); return s; });
      const bp = filt('bandpass', 10000, 0.8, t);
      const hp = filt('highpass', 7000, 0.7, t);
      const g = gainNode(0); perc(g, t, (open ? 0.55 : 1.0) * vel, dec, 0.0008);
      sum.connect(bp); bp.connect(hp); hp.connect(g);
      // a little air on top
      const n = noise(t, dec + 0.02); const nhp = filt('highpass', 8500, 0.7, t);
      const ng = gainNode(0); perc(ng, t, 0.05 * vel, dec * 0.8, 0.0008);
      n.connect(nhp); nhp.connect(ng); ng.connect(g);
      route(g, { gain: 0.75, rev: open ? 0.12 : 0.04 });
      oscs.forEach((s) => { s.start(t); s.stop(t + dec + 0.03); });
    };

    E.percussion = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      const mix = gainNode(1);
      if (model === 'bongo') {
        const s = osc('sine', 300, t); s.frequency.exponentialRampToValueAtTime(210, t + 0.025);
        const g = gainNode(0); perc(g, t, 0.75 * vel, 0.18);
        const n = noise(t, 0.02); const nb = filt('bandpass', 2000, 1.5, t); const ng = gainNode(0); perc(ng, t, 0.25 * vel, 0.012, 0.0005);
        s.connect(g); g.connect(mix); n.connect(nb); nb.connect(ng); ng.connect(mix);
        route(mix, { gain: 0.8, rev: 0.14 });
        s.start(t); s.stop(t + 0.22);
        return;
      }
      if (model === 'wood') {
        const a = osc('sine', 1250, t); const ag = gainNode(0); perc(ag, t, 0.5 * vel, 0.05);
        const b = osc('triangle', 2100, t); const bg = gainNode(0); perc(bg, t, 0.22 * vel, 0.022);
        a.connect(ag); b.connect(bg); ag.connect(mix); bg.connect(mix);
        route(mix, { gain: 0.8, rev: 0.16 });
        a.start(t); b.start(t); a.stop(t + 0.07); b.stop(t + 0.04);
        return;
      }
      // 808 cowbell: two squares, band-passed, two-stage decay
      const a = osc('square', 540, t); const b = osc('square', 800, t);
      const bp = filt('bandpass', 900, 1.2, t); const hp = filt('highpass', 350, 0.7, t);
      const g = gainNode(0);
      g.gain.setValueAtTime(TINY, t);
      g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.025);
      g.gain.exponentialRampToValueAtTime(TINY, t + 0.34);
      a.connect(bp); b.connect(bp); bp.connect(hp); hp.connect(g); g.connect(mix);
      route(mix, { gain: 0.7, rev: 0.1 });
      a.start(t); b.start(t); a.stop(t + 0.36); b.stop(t + 0.36);
    };

    // =====================================================================
    // BASS — follows the active clan's key and bassline
    // =====================================================================
    E.bass = (time, model, o) => {
      o = o || {};
      const t = T(time);
      const c = CLANS[E.clan] || CLANS.bboy;
      const semis = o.step != null ? c.bass[o.step % 16] : 0;
      const f = o.freq || midiHz(c.root + semis + (model === 'acid' ? 12 : 0));
      const dur = o.dur || stepSec() * 1.7;
      const driveK = 1.2 + (E.state.driveOn ? E.state.drive / 25 : 0) + c.color * 0.4;
      const vel = o.vel || 1;

      if (model === 'reese') {
        const saws = [-14, 0, 14].map((cents) => { const s = osc('sawtooth', f, t); s.detune.setValueAtTime(cents, t); return s; });
        const sub = osc('sine', f, t);
        const lp = filt('lowpass', 520, 1.4, t);
        const lfo = osc('sine', 0.7, t); const lfoG = gainNode(180); lfo.connect(lfoG); lfoG.connect(lp.frequency);
        const sh = shaper(driveK + 1);
        const g = gainNode(0); hold(g, t, 0.42 * vel, 0.006, dur, 0.06);
        const sawSum = gainNode(0.5); saws.forEach((s) => s.connect(sawSum));
        sawSum.connect(lp); lp.connect(sh); sh.connect(g);
        const sg = gainNode(0.55); sub.connect(sg); sg.connect(g);
        route(g, { gain: 0.85 });
        const end = t + dur + 0.08;
        [...saws, sub, lfo].forEach((s) => { s.start(t); s.stop(end); });
        return;
      }
      if (model === 'acid') {
        const s = osc('sawtooth', f, t);
        const lp = filt('lowpass', 200, 13, t);
        const accent = o.step != null && o.step % 4 === 2;
        lp.frequency.setValueAtTime(200, t);
        lp.frequency.exponentialRampToValueAtTime(accent ? 3200 : 2200, t + 0.012);
        lp.frequency.exponentialRampToValueAtTime(220, t + 0.2);
        const sh = shaper(driveK);
        const g = gainNode(0); hold(g, t, (accent ? 0.42 : 0.34) * vel, 0.004, dur * 0.8, 0.04);
        s.connect(lp); lp.connect(sh); sh.connect(g);
        route(g, { gain: 0.8, dly: 0.08 });
        s.start(t); s.stop(t + dur + 0.06);
        return;
      }
      // 'sine': deep sub, with a low-passed triangle octave so phones can hear it
      const s = osc('sine', f, t);
      const tri = osc('triangle', f * 2, t);
      const lp = filt('lowpass', 260, 0.7, t);
      const sh = shaper(driveK * 0.8);
      const tg = gainNode(0.22);
      const g = gainNode(0); hold(g, t, 0.75 * vel, 0.005, dur, 0.05);
      tri.connect(tg); tg.connect(lp); s.connect(lp); lp.connect(sh); sh.connect(g);
      route(g, { gain: 0.9 });
      s.start(t); tri.start(t); s.stop(t + dur + 0.07); tri.stop(t + dur + 0.07);
    };

    // =====================================================================
    // KEYS / CHORDS
    // =====================================================================
    function rhodesNote(t, f, peak, dur, out) {
      const car = osc('sine', f, t);
      const mod = osc('sine', f, t);
      const idx = gainNode(0);
      idx.gain.setValueAtTime(f * 2.2, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.4);
      mod.connect(idx); idx.connect(car.frequency);
      const tine = osc('sine', f * 4.01, t); const tg = gainNode(0); perc(tg, t, peak * 0.18, 0.12);
      const g = gainNode(0); hold(g, t, peak, 0.004, Math.max(0.05, dur - 0.05), 0.5);
      car.connect(g); tine.connect(tg); tg.connect(g); g.connect(out);
      const end = t + dur + 0.6;
      [car, mod, tine].forEach((s) => { s.start(t); s.stop(end); });
    }

    E.chord = (time, model, o) => {
      o = o || {};
      const t = T(time);
      const c = CLANS[E.clan] || CLANS.bboy;
      const notes = c.chords[(o.step || 0) < 8 ? 0 : 1];
      const dur = o.dur || stepSec() * 2.5;
      const vel = o.vel || 1;
      const bus = gainNode(1);

      if (model === 'saw') {
        const lp = filt('lowpass', 4200, 2, t);
        lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
        const g = gainNode(0); hold(g, t, 0.5 * vel, 0.004, dur * 0.6, 0.18);
        const oscs = [];
        notes.forEach((m) => [-12, 0, 12].forEach((cents) => {
          const s = osc('sawtooth', midiHz(m), t); s.detune.setValueAtTime(cents, t);
          const vg = gainNode(0.06); s.connect(vg); vg.connect(lp); oscs.push(s);
        }));
        lp.connect(g); g.connect(bus);
        route(bus, { gain: 0.8, rev: 0.2, dly: 0.15 });
        oscs.forEach((s) => { s.start(t); s.stop(t + dur + 0.3); });
        return;
      }
      if (model === 'flute') {
        const g = gainNode(1); g.connect(bus);
        const oscs = [];
        notes.forEach((m, i) => {
          const f = midiHz(m + 12);
          const s = osc('sine', f, t);
          const vib = osc('sine', 5.2, t); const vg = gainNode(f * 0.0035); vib.connect(vg); vg.connect(s.frequency);
          const ng = gainNode(0); hold(ng, t, 0.09 * vel, 0.06 + i * 0.01, dur, 0.25);
          s.connect(ng); ng.connect(g); oscs.push(s, vib);
        });
        const n = noise(t, dur + 0.3); const nb = filt('bandpass', midiHz(notes[0] + 24), 6, t);
        const breath = gainNode(0); hold(breath, t, 0.05 * vel, 0.05, dur, 0.2);
        n.connect(nb); nb.connect(breath); breath.connect(g);
        route(bus, { gain: 0.9, rev: 0.35, dly: 0.1 });
        oscs.forEach((s) => { s.start(t); s.stop(t + dur + 0.35); });
        return;
      }
      // 'soul': FM electric piano with tremolo
      const trem = osc('sine', 4.5, t); const tremDepth = gainNode(0.22); const tremBus = gainNode(0.78);
      trem.connect(tremDepth); tremDepth.connect(tremBus.gain);
      notes.forEach((m) => rhodesNote(t, midiHz(m), 0.13 * vel, dur, tremBus));
      tremBus.connect(bus);
      route(bus, { gain: 0.95, rev: 0.25, dly: 0.1 });
      trem.start(t); trem.stop(t + dur + 0.7);
    };

    // =====================================================================
    // VOCAL STABS — formant synthesis
    // =====================================================================
    const VOWELS = {
      EH: [[530, 60], [1840, 90], [2480, 120]],
      IY: [[270, 60], [2290, 90], [3010, 120]],
      AE: [[660, 70], [1720, 100], [2410, 120]],
      AA: [[730, 80], [1090, 90], [2440, 120]],
      OO: [[300, 60], [870, 80], [2240, 120]],
    };
    function formantBank(src, t, from, to, glide, out) {
      const amps = [1, 0.55, 0.32];
      from.forEach(([f, bw], i) => {
        const b = filt('bandpass', f, f / bw, t);
        if (to) b.frequency.exponentialRampToValueAtTime(to[i][0], t + glide);
        const g = gainNode(amps[i] * 4);
        src.connect(b); b.connect(g); g.connect(out);
      });
    }
    E.vocal = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      const cfg = {
        hey:  { f0: 210, f1: 185, dur: 0.26, from: VOWELS.EH, to: null, glide: 0, breath: 0.35, dly: 0.12 },
        yeah: { f0: 175, f1: 150, dur: 0.32, from: VOWELS.IY, to: VOWELS.AE, glide: 0.16, breath: 0.12, dly: 0.12 },
        drop: { f0: 150, f1: 98, dur: 0.36, from: VOWELS.AA, to: VOWELS.OO, glide: 0.3, breath: 0.08, dly: 0.45 },
      }[model] || null;
      const c = cfg || { f0: 210, f1: 185, dur: 0.26, from: VOWELS.EH, to: null, glide: 0, breath: 0.35, dly: 0.12 };
      const src = gainNode(1);
      const saw = osc('sawtooth', c.f0, t); saw.frequency.exponentialRampToValueAtTime(c.f1, t + c.dur);
      const sq = osc('square', c.f0 * 0.5, t); sq.frequency.exponentialRampToValueAtTime(c.f1 * 0.5, t + c.dur);
      const sqg = gainNode(0.3); sq.connect(sqg); sqg.connect(src); saw.connect(src);
      const vib = osc('sine', 5.5, t); const vg = gainNode(c.f0 * 0.012); vib.connect(vg); vg.connect(saw.frequency);
      const voice = gainNode(0); hold(voice, t, 0.32 * vel, 0.02, c.dur - 0.06, 0.07);
      formantBank(src, t, c.from, c.to, c.glide, voice);
      // consonant: breathy 'h' or plosive 'd'
      const n = noise(t, 0.08); const nb = filt('bandpass', model === 'drop' ? 900 : 1600, 1.2, t);
      const ng = gainNode(0); perc(ng, t, c.breath * vel, model === 'drop' ? 0.015 : 0.05);
      n.connect(nb); nb.connect(ng); ng.connect(voice);
      route(voice, { gain: 0.9, rev: 0.2, dly: c.dly });
      [saw, sq, vib].forEach((s) => { s.start(t); s.stop(t + c.dur + 0.1); });
    };

    // =====================================================================
    // GLITCH / TOMS
    // =====================================================================
    E.glitch = (time, model, o) => {
      const t = T(time); const vel = (o && o.vel) || 1;
      if (model === 'laser') {
        const car = osc('square', 1800, t); car.frequency.exponentialRampToValueAtTime(120, t + 0.14);
        const mod = osc('sine', 3620, t); const idx = gainNode(600);
        idx.gain.exponentialRampToValueAtTime(20, t + 0.14);
        mod.connect(idx); idx.connect(car.frequency);
        const lp = filt('lowpass', 5000, 6, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.15);
        const g = gainNode(0); perc(g, t, 0.32 * vel, 0.16);
        car.connect(lp); lp.connect(g);
        route(g, { gain: 0.8, dly: 0.25 });
        car.start(t); mod.start(t); car.stop(t + 0.2); mod.stop(t + 0.2);
        return;
      }
      if (model === 'whoosh') {
        const n = noise(t, 0.4);
        const bp = filt('bandpass', 400, 2, t); bp.frequency.exponentialRampToValueAtTime(6000, t + 0.34);
        const g = gainNode(0);
        g.gain.setValueAtTime(TINY, t);
        g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.33);
        g.gain.linearRampToValueAtTime(TINY, t + 0.35);
        n.connect(bp); bp.connect(g);
        route(g, { gain: 0.8, rev: 0.3 });
        return;
      }
      // tribal low tom
      const s = osc('sine', 140, t); s.frequency.exponentialRampToValueAtTime(76, t + 0.12);
      const tri = osc('triangle', 280, t); tri.frequency.exponentialRampToValueAtTime(150, t + 0.1);
      const g = gainNode(0); perc(g, t, 0.85 * vel, 0.36);
      const tg = gainNode(0); perc(tg, t, 0.18 * vel, 0.12);
      const n = noise(t, 0.06); const nb = filt('bandpass', 900, 1.2, t); const ng = gainNode(0); perc(ng, t, 0.2 * vel, 0.05);
      const mix = gainNode(1);
      s.connect(g); tri.connect(tg); n.connect(nb); nb.connect(ng);
      [g, tg, ng].forEach((x) => x.connect(mix));
      route(mix, { gain: 0.85, rev: 0.25 });
      s.start(t); tri.start(t); s.stop(t + 0.42); tri.stop(t + 0.2);
    };

    // =====================================================================
    // PERFORMANCE FX PADS
    // =====================================================================
    E.fx = (type, time) => {
      const t = T(time);
      const c = CLANS[E.clan] || CLANS.bboy;
      const fxHit = kitFx(type);
      if (fxHit && fxHit.kit.buffers[fxHit.entry.file]) {
        playBuffer(fxHit.kit.buffers[fxHit.entry.file], t, { gain: 0.6, rev: type === 'gong' ? 0.45 : 0.25 });
        if (type === 'metal') E.kick(t, 'hard');
        return;
      }
      switch (type) {
        case 'siren': {
          const s = osc('square', 560, t);
          s.frequency.linearRampToValueAtTime(640, t + 0.9);
          const lfo = osc('sine', 4.5, t); const lg = gainNode(210); lfo.connect(lg); lg.connect(s.frequency);
          const lp = filt('lowpass', 3200, 0.8, t);
          const g = gainNode(0); hold(g, t, 0.26, 0.01, 0.85, 0.15);
          s.connect(lp); lp.connect(g);
          route(g, { gain: 0.9, rev: 0.2, dly: 0.55, clanSpace: false });
          s.start(t); lfo.start(t); s.stop(t + 1.05); lfo.stop(t + 1.05);
          break;
        }
        case 'sub': {
          const s = osc('sine', 80, t); s.frequency.exponentialRampToValueAtTime(28, t + 0.9);
          const tri = osc('triangle', 160, t); tri.frequency.exponentialRampToValueAtTime(56, t + 0.9);
          const tg = gainNode(0.2); tri.connect(tg);
          const sh = shaper(2.4);
          const g = gainNode(0); perc(g, t, 0.95, 1.15, 0.004);
          s.connect(sh); tg.connect(sh); sh.connect(g);
          route(g, { gain: 0.95 });
          s.start(t); tri.start(t); s.stop(t + 1.25); tri.stop(t + 1.25);
          break;
        }
        case 'scratch': {
          // platter motion: fast forward-back-forward strokes drive pitch and filter
          const dur = 0.36, pts = 96;
          const fCurve = new Float32Array(pts), bpCurve = new Float32Array(pts), gCurve = new Float32Array(pts);
          for (let i = 0; i < pts; i++) {
            const x = i / (pts - 1);
            const speed = Math.abs(Math.sin(Math.PI * 3 * x)) * (1 - 0.3 * x);
            fCurve[i] = 90 + speed * 900;
            bpCurve[i] = 400 + speed * 2600;
            gCurve[i] = Math.pow(speed, 0.6) * 0.5;
          }
          const s = osc('sawtooth', 200, t); s.frequency.setValueCurveAtTime(fCurve, t, dur);
          const n = noise(t, dur);
          const bp = filt('bandpass', 1000, 2.2, t); bp.frequency.setValueCurveAtTime(bpCurve, t, dur);
          const g = gainNode(0); g.gain.setValueCurveAtTime(gCurve, t, dur);
          const ng = gainNode(0.6); n.connect(ng);
          s.connect(bp); ng.connect(bp); bp.connect(g);
          route(g, { gain: 0.9, rev: 0.08 });
          s.start(t); s.stop(t + dur + 0.02);
          break;
        }
        case 'laser': {
          E.glitch(t, 'laser', { vel: 1.3 });
          E.glitch(t + stepSec(), 'laser', { vel: 0.7 });
          break;
        }
        case 'stop': {
          // tape stop on the clan chord: pitch dives, filter closes
          const lp = filt('lowpass', 4000, 1, t); lp.frequency.exponentialRampToValueAtTime(150, t + 0.6);
          const g = gainNode(0); hold(g, t, 0.3, 0.005, 0.5, 0.12);
          const oscs = c.chords[0].map((m) => {
            const s = osc('sawtooth', midiHz(m), t);
            s.frequency.exponentialRampToValueAtTime(midiHz(m) / 16, t + 0.62);
            s.connect(lp); return s;
          });
          lp.connect(g);
          route(g, { gain: 0.6 });
          oscs.forEach((s) => { s.start(t); s.stop(t + 0.66); });
          break;
        }
        case 'riser': {
          const n = noise(t, 1.0);
          const bp = filt('bandpass', 300, 1.5, t); bp.frequency.exponentialRampToValueAtTime(5000, t + 0.9);
          const s = osc('sawtooth', 200, t); s.frequency.exponentialRampToValueAtTime(1600, t + 0.9);
          const sg = gainNode(0.25); s.connect(sg); sg.connect(bp);
          const g = gainNode(0);
          g.gain.setValueAtTime(0.03, t);
          g.gain.linearRampToValueAtTime(0.6, t + 0.88);
          g.gain.exponentialRampToValueAtTime(TINY, t + 0.95);
          n.connect(bp); bp.connect(g);
          route(g, { gain: 0.8, rev: 0.3 });
          s.start(t); s.stop(t + 0.96);
          break;
        }
        case 'airhorn': {
          // sound-system horn: brassy detuned saws, stuttered "baap-baap-baaaap"
          [[0, 0.09], [0.13, 0.09], [0.26, 0.48]].forEach(([d, len]) => {
            const st = t + d;
            const bp = filt('bandpass', 1500, 0.7, st);
            const lp = filt('lowpass', 3200, 0.7, st);
            const sh = shaper(3);
            const g = gainNode(0); hold(g, st, 0.22, 0.008, len, 0.06);
            const oscs = [];
            [466, 699].forEach((f) => [-8, 8].forEach((cents) => {
              const s = osc('sawtooth', f * 0.97, st);
              s.frequency.linearRampToValueAtTime(f, st + 0.03);
              if (len > 0.3) s.frequency.linearRampToValueAtTime(f * 0.93, st + len);
              s.detune.setValueAtTime(cents, st); s.connect(bp); oscs.push(s);
            }));
            bp.connect(lp); lp.connect(sh); sh.connect(g);
            route(g, { gain: 0.8, rev: 0.15, dly: 0.2 });
            oscs.forEach((s) => { s.start(st); s.stop(st + len + 0.1); });
          });
          break;
        }
        case 'amen': {
          // accelerating snare roll with a crescendo
          let d = 0;
          for (let i = 0; i < 10; i++) {
            E.snare(t + d, 'crisp', { vel: 0.45 + i * 0.06 });
            d += Math.max(0.032, 0.075 - i * 0.006);
          }
          E.kick(t + d, 'punch');
          break;
        }
        case 'metal': {
          // industrial clang: FM metal + noise burst + hard kick
          const car = osc('sine', 220, t);
          const mod = osc('sine', 220 * 1.414, t); const idx = gainNode(900);
          idx.gain.exponentialRampToValueAtTime(40, t + 0.6);
          mod.connect(idx); idx.connect(car.frequency);
          const sh = shaper(4);
          const g = gainNode(0); perc(g, t, 0.35, 0.7);
          car.connect(sh); sh.connect(g);
          const n = noise(t, 0.1); const nb = filt('bandpass', 2500, 1.2, t); const ng = gainNode(0); perc(ng, t, 0.4, 0.08);
          n.connect(nb); nb.connect(ng); ng.connect(g);
          route(g, { gain: 0.8, rev: 0.25 });
          car.start(t); mod.start(t); car.stop(t + 0.8); mod.stop(t + 0.8);
          E.kick(t, 'hard');
          break;
        }
        case 'gong': {
          // tribal gong: inharmonic partials with slow beating, mallet thump, long tail
          const base = 98;
          const parts = [[1, 1, 2.6], [1.47, 0.6, 2.2], [2.09, 0.5, 1.8], [2.56, 0.35, 1.5], [3.18, 0.3, 1.2], [3.95, 0.2, 1.0], [4.7, 0.15, 0.8]];
          const bus = gainNode(1);
          const oscs = [];
          parts.forEach(([r, a, dec]) => [0, 0.35].forEach((beat) => {
            const s = osc('sine', base * r + beat, t);
            const g = gainNode(0);
            g.gain.setValueAtTime(TINY, t);
            g.gain.linearRampToValueAtTime(a * 0.09, t + 0.02);
            g.gain.exponentialRampToValueAtTime(TINY, t + dec);
            s.connect(g); g.connect(bus); oscs.push([s, dec]);
          }));
          const th = osc('sine', 80, t); th.frequency.exponentialRampToValueAtTime(58, t + 0.15);
          const tg = gainNode(0); perc(tg, t, 0.5, 0.18); th.connect(tg); tg.connect(bus);
          route(bus, { gain: 1, rev: 0.45 });
          oscs.forEach(([s, dec]) => { s.start(t); s.stop(t + dec + 0.05); });
          th.start(t); th.stop(t + 0.25);
          break;
        }
        default:
          E.glitch(t, 'laser');
      }
    };

    // =====================================================================
    // SYNTH LAB KEYBOARD
    // =====================================================================
    E.keyNote = (freq, preset, time) => {
      const t = T(time);
      const f = freq;
      if (preset === 'wobble') {
        const s = osc('sawtooth', f, t); const sub = osc('square', f / 2, t);
        const lp = filt('lowpass', 300, 9, t);
        const rate = (E.bpm / 60) * 2; // eighth-note wobble, locked to tempo
        const lfo = osc('sine', rate, t); const lg = gainNode(1400); lfo.connect(lg); lg.connect(lp.frequency);
        const sh = shaper(2.5);
        const g = gainNode(0); hold(g, t, 0.36, 0.008, 0.62, 0.1);
        const sg = gainNode(0.5); sub.connect(sg);
        s.connect(lp); sg.connect(lp); lp.connect(sh); sh.connect(g);
        route(g, { gain: 0.9, dly: 0.12 });
        [s, sub, lfo].forEach((x) => { x.start(t); x.stop(t + 0.75); });
        return;
      }
      if (preset === 'industrial') {
        const a = osc('sawtooth', f, t); a.detune.setValueAtTime(-15, t);
        const b = osc('sawtooth', f, t); b.detune.setValueAtTime(15, t);
        const sub = osc('square', f / 2, t);
        const sh = shaper(6); const lp = filt('lowpass', 2600, 1.2, t);
        const g = gainNode(0); hold(g, t, 0.24, 0.005, 0.42, 0.1);
        const sg = gainNode(0.4); sub.connect(sg);
        a.connect(sh); b.connect(sh); sg.connect(sh); sh.connect(lp); lp.connect(g);
        route(g, { gain: 0.85, rev: 0.12 });
        [a, b, sub].forEach((x) => { x.start(t); x.stop(t + 0.56); });
        return;
      }
      if (preset === 'rhodes') {
        const bus = gainNode(1);
        rhodesNote(t, f, 0.32, 0.9, bus);
        route(bus, { gain: 0.95, rev: 0.25, dly: 0.08 });
        return;
      }
      if (preset === 'gong') {
        const car = osc('sine', f, t);
        const mod = osc('sine', f * 3.5, t); const idx = gainNode(f * 2);
        idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.6);
        mod.connect(idx); idx.connect(car.frequency);
        const p = osc('sine', f * 2.76, t); const pg = gainNode(0); perc(pg, t, 0.06, 0.9);
        const g = gainNode(0); perc(g, t, 0.3, 1.8, 0.004);
        car.connect(g); p.connect(pg); pg.connect(g);
        route(g, { gain: 0.9, rev: 0.35 });
        [car, mod, p].forEach((x) => { x.start(t); x.stop(t + 1.9); });
        return;
      }
      // 'vocoder' lead: saw + square through morphing formants
      const src = gainNode(1);
      const s = osc('sawtooth', f, t); const q = osc('square', f, t); const qg = gainNode(0.35);
      q.connect(qg); qg.connect(src); s.connect(src);
      const vib = osc('sine', 5.5, t); const vg = gainNode(f * 0.01); vib.connect(vg); vg.connect(s.frequency);
      const voice = gainNode(0); hold(voice, t, 0.22, 0.01, 0.45, 0.12);
      formantBank(src, t, VOWELS.AA, VOWELS.OO, 0.4, voice);
      route(voice, { gain: 0.9, rev: 0.18, dly: 0.12 });
      [s, q, vib].forEach((x) => { x.start(t); x.stop(t + 0.62); });
    };

    // =====================================================================
    // UI MICRO-INTERACTIONS
    // =====================================================================
    E.ui = (type, o) => {
      o = o || {};
      const t = now() + 0.005;
      const out = N.uiBus;
      const tickAt = (st, peak) => {
        const n = noise(st, 0.01);
        const hp = filt('highpass', 2500, 0.7, st); const bp = filt('bandpass', 4200, 3, st);
        const g = gainNode(0); perc(g, st, peak, 0.004, 0.0003);
        n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
      };
      const blip = (st, f0, f1, peak, dec, type) => {
        const s = osc(type || 'sine', f0, st); if (f1) s.frequency.exponentialRampToValueAtTime(f1, st + dec);
        const g = gainNode(0); perc(g, st, peak, dec); s.connect(g); g.connect(out);
        s.start(st); s.stop(st + dec + 0.02);
      };
      switch (type) {
        case 'click': // relay: two contacts closing + a small thunk
          tickAt(t, 0.9); tickAt(t + 0.017, 0.45);
          blip(t, 180, 120, 0.25, 0.02);
          break;
        case 'on':
          tickAt(t, 0.8); blip(t + 0.012, 1320, 1760, 0.18, 0.06);
          break;
        case 'off':
          tickAt(t, 0.8); blip(t + 0.012, 1320, 880, 0.18, 0.06);
          break;
        case 'step':
          tickAt(t, 0.35);
          break;
        case 'servo': { // gear motor whir that swings up and settles, ends on a latch click
          const dur = 0.3;
          const a = osc('sawtooth', 90, t); const b = osc('square', 181, t);
          const bp = filt('bandpass', 600, 4, t);
          bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.45);
          bp.frequency.exponentialRampToValueAtTime(900, t + dur);
          const chatter = osc('square', 28, t); const cg = gainNode(0.18); const vca = gainNode(0.22);
          chatter.connect(cg); cg.connect(vca.gain);
          const g = gainNode(0); hold(g, t, 0.55, 0.02, dur - 0.05, 0.04);
          a.connect(bp); b.connect(bp); bp.connect(vca); vca.connect(g); g.connect(out);
          [a, b, chatter].forEach((x) => { x.start(t); x.stop(t + dur + 0.06); });
          tickAt(t + dur, 0.7);
          break;
        }
        case 'hit': { // arcade confirm chime, climbs with the combo
          const combo = clamp(o.combo || 0, 0, 24);
          const base = 1046.5 * Math.pow(2, Math.min(combo, 12) / 24);
          blip(t, base, null, 0.28, 0.16, 'triangle');
          blip(t + 0.045, base * 1.5, null, 0.22, 0.2, 'triangle');
          if (combo >= 10) blip(t + 0.09, base * 2, null, 0.16, 0.22, 'sine');
          break;
        }
        case 'miss':
          blip(t, 140, 90, 0.3, 0.18, 'square');
          break;
        case 'chime': // success arpeggio
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(t + i * 0.07, f, null, 0.24, 0.5, 'triangle'));
          break;
        default:
          tickAt(t, 0.6);
      }
    };

    // Track dispatch used by the sequencer: 0 kick, 1 snare, 2 hat, 3 perc, 4 bass, 5 chord, 6 vocal, 7 glitch
    E.playTrack = (trackIdx, time, model, step, extra) => {
      const o = Object.assign({ step, dur: undefined }, extra || {});
      if (playSampleTrack(trackIdx, model, T(time), o)) return;
      switch (trackIdx) {
        case 0: return E.kick(time, model, o);
        case 1: return E.snare(time, model, o);
        case 2: return E.hat(time, model, o);
        case 3: return E.percussion(time, model, o);
        case 4: return E.bass(time, model, o);
        case 5: return E.chord(time, model, o);
        case 6: return E.vocal(time, model, o);
        case 7: return E.glitch(time, model, o);
      }
    };

    E.setClan(E.clan);
    E.setTape(true);
    E.setDrive(false, 15);
    return E;
  }

  /**
   * Render a pattern offline (for WAV export) with the same engine and settings.
   * opts: { pattern, models[8], mutes[8], solos[8], bpm, swing, clan, bars, settings, sampleRate }
   */
  async function renderPattern(opts) {
    const sr = opts.sampleRate || 44100;
    const bars = opts.bars || 2;
    const stepDur = 60 / opts.bpm / 4;
    const length = Math.ceil(sr * stepDur * 16 * bars);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, length, sr);
    const E = createEngine(ctx, {});
    E.setTempo(opts.bpm);
    if (opts.kit) E.useKit(opts.clan || 'bboy', opts.kit);
    E.setClan(opts.clan || 'bboy');
    const s = opts.settings || {};
    if (s.hp != null) E.nodes.highpass.frequency.value = s.hp;
    if (s.lp != null) E.nodes.lowpass.frequency.value = s.lp;
    if (s.delayTime != null) E.nodes.delay.delayTime.value = s.delayTime;
    E.nodes.dlyRet.gain.value = s.delayOn === false ? 0 : 0.55;
    E.setDrive(!!s.driveOn, s.drive);
    E.setTape(s.tapeOn !== false);
    const anySolo = (opts.solos || []).some(Boolean);
    for (let i = 0; i < 16 * bars; i++) {
      const step = i % 16;
      const swing = step % 2 ? stepDur * (opts.swing || 0) / 100 * 0.66 : 0;
      const time = i * stepDur + swing + 0.001;
      for (let tr = 0; tr < 8; tr++) {
        if (!opts.pattern[tr][step]) continue;
        if (opts.mutes && opts.mutes[tr]) continue;
        if (anySolo && !opts.solos[tr]) continue;
        E.playTrack(tr, time, opts.models[tr], step);
      }
    }
    return ctx.startRendering();
  }

  function bufferToWav(buffer) {
    const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    const dataLen = n * ch * 2;
    const view = new DataView(new ArrayBuffer(44 + dataLen));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
    w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, dataLen, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const v = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true); off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  window.BBAudio = { createEngine, renderPattern, bufferToWav, CLANS, midiHz };
})();
