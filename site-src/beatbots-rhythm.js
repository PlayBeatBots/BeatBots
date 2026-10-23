/*
 * BeatBots Rhythm Battle engine — track-agnostic BeatMap charts on the audio clock.
 *
 *   const rhythm = new BBRhythm.RhythmEngine({ getEngine: () => bbEngine });
 *   rhythm.loadBeatMap(BBRhythm.LIBRARY[0]);          // or any BeatMap JSON
 *   rhythm.start({ travelTime: 1.8, duration: 45, onHit, onMiss, onEnd });
 *   // every animation frame:
 *   const f = rhythm.frame();   // { time, notes: [{ lane, progress, chordId, judged }], ... }
 *   // on key/tap:
 *   const r = rhythm.hit(lane); // { judgement: 'perfect'|'great'|'good', offsetMs, note } or null
 *
 * BeatMap format (JSON):
 * {
 *   "id": "track01", "title": "...", "artist": "...", "clan": "bboy",
 *   "bpm": 96, "beatsPerBar": 4, "bars": 4,
 *   "scale": { "root": "A4", "mode": "minorPentatonic" },   // informational + default lane notes
 *   "laneNotes": ["A4", "C5", "E5"],                        // pitch each lane plays (optional)
 *   "synth": { "wave": "sawtooth", "cutoff": 3200, "decay": 0.32 },   // pluck tone (optional)
 *   "backing": { "steps": 16, "swing": 18,                  // optional drum/bass loop under the chart
 *                "models": ["punch","crisp","closed","cowbell","sine","soul","hey","tom"],
 *                "pattern": [[...16 or steps*bars per sequencer track...] x 8] },
 *   "notes": [ { "beat": 0, "lanes": [0] },                 // beat = quarter notes from bar 1
 *              { "beat": 2.5, "lanes": [1] },               // 8th-note syncopation
 *              { "beat": 4, "lanes": [0, 2] },              // two-lane chord
 *              { "t": 9.375, "lanes": [2], "note": "G5" } ] // or absolute seconds; per-note pitch override
 * }
 */
(function () {
  'use strict';

  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SCALES = {
    minorPentatonic: [0, 3, 5, 7, 10],
    majorPentatonic: [0, 2, 4, 7, 9],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    blues: [0, 3, 5, 6, 7, 10],
  };

  function noteToMidi(n) {
    if (typeof n === 'number') return n;
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(n).trim());
    if (!m) throw new Error(`BeatMap: bad note name "${n}" (use e.g. "A4", "C#5")`);
    const pc = NOTE_INDEX[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + pc;
  }
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Default lane pitches from a scale: tonic, 3rd scale degree, 5th scale degree (A4 / C5 / E5 in A minor pent.)
  function laneNotesFromScale(scale, lanes) {
    const root = noteToMidi((scale && scale.root) || 'A4');
    const steps = SCALES[(scale && scale.mode) || 'minorPentatonic'] || SCALES.minorPentatonic;
    const out = [];
    for (let i = 0; i < lanes; i++) {
      const deg = i * 2; // every other scale step: 1st, 3rd, 5th…
      out.push(root + steps[deg % steps.length] + 12 * Math.floor(deg / steps.length));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // RhythmSynth: retro pluck (saw + detuned square + sub) through an enveloped lowpass
  // ---------------------------------------------------------------------------
  class RhythmSynth {
    constructor(engine, opts) {
      this.engine = engine;
      this.opts = Object.assign({ wave: 'sawtooth', cutoff: 3200, decay: 0.32, gain: 0.42 }, opts || {});
    }
    pluck(midi, o) {
      const E = this.engine; if (!E) return;
      const ctx = E.ctx;
      const p = Object.assign({}, this.opts, o || {});
      const t = p.time || ctx.currentTime;
      const f = midiHz(midi);
      const vel = p.vel == null ? 1 : p.vel;
      const a = ctx.createOscillator(); a.type = p.wave; a.frequency.setValueAtTime(f, t);
      const b = ctx.createOscillator(); b.type = 'square'; b.frequency.setValueAtTime(f, t); b.detune.setValueAtTime(7, t);
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(f / 2, t);
      const bg = ctx.createGain(); bg.gain.value = 0.35;
      const sg = ctx.createGain(); sg.gain.value = 0.3;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.setValueAtTime(4, t);
      const peakCut = Math.min(16000, p.cutoff * (0.7 + 0.6 * vel));
      lp.frequency.setValueAtTime(peakCut, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.2), t + p.decay * 0.85);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.linearRampToValueAtTime(p.gain * vel, t + 0.002);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      a.connect(lp); b.connect(bg); bg.connect(lp); sub.connect(sg); sg.connect(lp); lp.connect(amp);
      E.connectVoice(amp, { rev: 0.18, dly: 0.12 });
      [a, b, sub].forEach((x) => { x.start(t); x.stop(t + p.decay + 0.05); });
    }
  }

  // ---------------------------------------------------------------------------
  // BeatMap loading / validation
  // ---------------------------------------------------------------------------
  function normalizeBeatMap(track, lanes) {
    if (!track || typeof track !== 'object') throw new Error('BeatMap: expected an object');
    const bpm = Number(track.bpm);
    if (!(bpm >= 40 && bpm <= 240)) throw new Error('BeatMap: bpm must be between 40 and 240');
    const beatsPerBar = Number(track.beatsPerBar || 4);
    const spb = 60 / bpm;
    let bars = Number(track.bars || 0);
    const raw = Array.isArray(track.notes) ? track.notes : [];
    if (!raw.length) throw new Error('BeatMap: "notes" is empty');
    const laneMidi = (track.laneNotes || laneNotesFromScale(track.scale, lanes)).map(noteToMidi);
    if (laneMidi.length < lanes) throw new Error(`BeatMap: laneNotes needs ${lanes} entries`);

    const notes = [];
    raw.forEach((n, i) => {
      const t = n.t != null ? Number(n.t) : Number(n.beat) * spb;
      if (!(t >= 0)) throw new Error(`BeatMap: note ${i} needs a "beat" or "t" >= 0`);
      const ls = Array.isArray(n.lanes) ? n.lanes : [n.lane];
      ls.forEach((lane) => {
        if (!(lane >= 0 && lane < lanes)) throw new Error(`BeatMap: note ${i} lane ${lane} out of range 0-${lanes - 1}`);
        notes.push({ time: t, lane, midi: n.note != null ? noteToMidi(n.note) : laneMidi[lane], chordId: ls.length > 1 ? i : null });
      });
    });
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    const lastBeat = notes[notes.length - 1].time / spb;
    if (!bars) bars = Math.max(1, Math.ceil((lastBeat + 0.001) / beatsPerBar));
    const length = bars * beatsPerBar * spb;
    if (notes[notes.length - 1].time >= length) throw new Error('BeatMap: a note falls after the last bar — raise "bars"');

    const backing = track.backing && Array.isArray(track.backing.pattern) ? {
      steps: Number(track.backing.steps || 16),
      swing: Number(track.backing.swing || 0),
      models: track.backing.models || [],
      pattern: track.backing.pattern,
      mutes: track.backing.mutes || [],
    } : null;

    return {
      id: track.id || 'custom', title: track.title || 'Untitled', artist: track.artist || '',
      clan: track.clan || null, bpm, beatsPerBar, bars, length, laneMidi,
      synth: track.synth || {}, backing, notes,
      nps: +(notes.length / length).toFixed(2),
    };
  }

  // ---------------------------------------------------------------------------
  // RhythmEngine
  // ---------------------------------------------------------------------------
  const WINDOWS = { perfect: 0.05, great: 0.09, good: 0.135 }; // seconds either side of the beat

  class RhythmEngine {
    constructor(opts) {
      opts = opts || {};
      this.lanes = opts.lanes || 3;
      this.getEngine = opts.getEngine || (() => null);
      this.windows = Object.assign({}, WINDOWS, opts.windows || {});
      this.chart = null;
      this.running = false;
    }

    loadBeatMap(track) {
      this.chart = normalizeBeatMap(track, this.lanes);
      this.synth = new RhythmSynth(this.getEngine(), this.chart.synth);
      return { title: this.chart.title, bpm: this.chart.bpm, bars: this.chart.bars, length: this.chart.length, notes: this.chart.notes.length, nps: this.chart.nps };
    }

    // Audio-clock time, interpolated between audio callbacks for smooth visuals and fair judging
    now() {
      const E = this.getEngine(); const ctx = E && E.ctx;
      if (!ctx) return 0;
      let t = ctx.currentTime;
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        if (ts && ts.contextTime > 0 && ts.performanceTime > 0) t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
      return t;
    }
    songTime() { return this.now() - this.t0; }

    start(o) {
      if (!this.chart) throw new Error('RhythmEngine: loadBeatMap() first');
      const E = this.getEngine(); if (!E) throw new Error('RhythmEngine: audio engine not ready');
      o = o || {};
      this.synth.engine = E;
      this.travelTime = o.travelTime || 1.8;
      this.duration = o.duration || this.chart.length;
      this.loop = o.loop !== false;
      this.onHit = o.onHit || (() => {}); this.onMiss = o.onMiss || (() => {}); this.onEnd = o.onEnd || (() => {});
      this.leadIn = o.leadIn != null ? o.leadIn : this.travelTime + 0.4; // notes start above the screen
      this.t0 = E.ctx.currentTime + this.leadIn;
      this.queue = []; this.nextLoop = 0; this.nextId = 0;
      this.backingStep = 0; this.backingTime = this.t0;
      this.stats = { notes: 0, hits: 0, perfect: 0, great: 0, good: 0, misses: 0 };
      this.running = true;
      this.fillQueue();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
      return { startsAt: this.t0, leadIn: this.leadIn };
    }

    stop() {
      this.running = false;
      clearInterval(this.timer);
    }

    // queue notes up to a few seconds ahead, looping the chart for the round length
    fillQueue() {
      const c = this.chart;
      const horizon = this.songTime() + this.travelTime + 2;
      while ((this.loop || this.nextLoop === 0) && this.nextLoop * c.length < Math.min(horizon, this.duration)) {
        const off = this.nextLoop * c.length;
        c.notes.forEach((n) => {
          const time = n.time + off;
          if (time < this.duration) {
            this.queue.push({ id: this.nextId++, time, lane: n.lane, midi: n.midi, chordId: n.chordId == null ? null : `${this.nextLoop}:${n.chordId}`, judged: null });
            this.stats.notes++;
          }
        });
        this.nextLoop++;
        if (!this.loop) break;
      }
    }

    // backing loop + auto-miss + end detection
    tick() {
      if (!this.running) return;
      const E = this.getEngine(); const c = this.chart;
      const st = this.songTime();
      this.fillQueue();
      if (c.backing && E) {
        const stepDur = (60 / c.bpm) * (4 / c.backing.steps);
        const endAt = this.t0 + this.duration;
        while (this.backingTime < E.ctx.currentTime + 0.12 && this.backingTime < endAt) {
          const s = this.backingStep;
          const swing = s % 2 ? stepDur * (c.backing.swing / 100) * 0.66 : 0;
          c.backing.pattern.forEach((row, tr) => {
            if (!row || !row.length || c.backing.mutes[tr]) return;
            if (row[s % row.length]) E.playTrack(tr, this.backingTime + swing, c.backing.models[tr] || 'default', s % 16);
          });
          this.backingStep++; this.backingTime += stepDur;
        }
      }
      const late = this.windows.good;
      for (const n of this.queue) {
        if (!n.judged && st - n.time > late) { n.judged = 'miss'; this.stats.misses++; this.onMiss(n); }
      }
      this.queue = this.queue.filter((n) => !n.judged || st - n.time < 1);
      if (st >= this.duration + late) { this.stop(); this.onEnd(this.stats); }
    }

    // positions for drawing: progress 0 = spawn (top), 1 = hit line
    frame() {
      const st = this.songTime();
      const notes = [];
      for (const n of this.queue) {
        if (n.judged && n.judged !== 'miss') continue;
        const progress = 1 - (n.time - st) / this.travelTime;
        if (progress < -0.05 || progress > 1.35) continue;
        notes.push({ id: n.id, lane: n.lane, progress, chordId: n.chordId, missed: n.judged === 'miss' });
      }
      return { time: st, duration: this.duration, remaining: Math.max(0, this.duration - st), notes };
    }

    // player input on a lane — judges the nearest unjudged note in that lane
    hit(lane) {
      if (!this.running) return null;
      const st = this.songTime();
      let best = null;
      for (const n of this.queue) {
        if (n.judged || n.lane !== lane) continue;
        const d = st - n.time;
        if (Math.abs(d) <= this.windows.good && (!best || Math.abs(d) < Math.abs(st - best.time))) best = n;
      }
      if (!best) return null;
      const off = st - best.time;
      const a = Math.abs(off);
      const judgement = a <= this.windows.perfect ? 'perfect' : a <= this.windows.great ? 'great' : 'good';
      best.judged = judgement;
      this.stats.hits++; this.stats[judgement]++;
      this.synth.pluck(best.midi, { vel: judgement === 'perfect' ? 1 : judgement === 'great' ? 0.85 : 0.7 });
      const res = { judgement, offsetMs: Math.round(off * 1000), note: best };
      this.onHit(res);
      return res;
    }
  }

  // ---------------------------------------------------------------------------
  // Sequencer -> BeatMap bridge
  // ---------------------------------------------------------------------------
  // Default: kick + bass -> left lane, snare + vocal -> center, perc + chord + glitch -> right.
  // Hi-hats stay in the backing only (16ths would be unplayable).
  const DEFAULT_LANE_MAP = { 0: 0, 4: 0, 1: 1, 6: 1, 3: 2, 5: 2, 7: 2 };

  function fromSequencerGrid(pattern, o) {
    o = o || {};
    if (!Array.isArray(pattern) || !pattern.length) throw new Error('fromSequencerGrid: empty pattern');
    const steps = o.steps || pattern[0].length || 16;
    const laneMap = o.laneMap || DEFAULT_LANE_MAP;
    const notes = [];
    for (let s = 0; s < steps; s++) {
      const lanes = new Set();
      Object.entries(laneMap).forEach(([tr, lane]) => {
        if (pattern[tr] && pattern[tr][s] && !(o.mutes && o.mutes[tr])) lanes.add(lane);
      });
      if (lanes.size) notes.push({ beat: s * (4 / steps), lanes: [...lanes].sort() });
    }
    if (!notes.length) throw new Error('Your pattern has no kick, snare, perc, bass, keys, vocal or glitch hits to play.');
    return {
      id: o.id || `station-${Date.now()}`,
      title: o.title || 'Your Station Loop',
      artist: o.artist || 'You',
      clan: o.clan || null,
      bpm: o.bpm || 105,
      beatsPerBar: 4,
      bars: 1,
      scale: o.scale || { root: 'A4', mode: 'minorPentatonic' },
      laneNotes: o.laneNotes,
      synth: o.synth,
      backing: { steps, swing: o.swing || 0, models: o.models || [], mutes: o.mutes || [], pattern: pattern.map((r) => r.slice()) },
      notes,
    };
  }

  // ---------------------------------------------------------------------------
  // Official library
  // ---------------------------------------------------------------------------
  const TRACK_01 = {
    id: 'track01',
    title: 'Intergalactic Cypher (Track 01)',
    artist: 'BeatBots',
    clan: 'bboy',
    bpm: 96,
    beatsPerBar: 4,
    bars: 4,
    scale: { root: 'A4', mode: 'minorPentatonic' },
    laneNotes: ['A4', 'C5', 'E5'],
    synth: { wave: 'sawtooth', cutoff: 3400, decay: 0.3 },
    backing: {
      steps: 16,
      swing: 18,
      models: ['punch', 'crisp', 'closed', 'cowbell', 'sine', 'soul', 'hey', 'tom'],
      pattern: [
        [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0], // kick
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // snare
        [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1], // hats
        [], // perc
        [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0], // bass (follows the clan bassline)
        [], [], [],
      ],
    },
    notes: [
      // bar 1 — call: up the chord, 8th-note pickup
      { beat: 0, lanes: [0] }, { beat: 1, lanes: [1] }, { beat: 2, lanes: [2] }, { beat: 2.5, lanes: [1] }, { beat: 3, lanes: [0] },
      // bar 2 — chord hit, 16th syncopation
      { beat: 4, lanes: [0, 2] }, { beat: 5, lanes: [1] }, { beat: 5.75, lanes: [2] }, { beat: 6, lanes: [1] }, { beat: 7, lanes: [0] },
      // bar 3 — busier response
      { beat: 8, lanes: [0] }, { beat: 8.5, lanes: [0] }, { beat: 9, lanes: [1] }, { beat: 10, lanes: [2] },
      { beat: 10.75, lanes: [1] }, { beat: 11, lanes: [2] }, { beat: 11.5, lanes: [1] },
      // bar 4 — chords into the turnaround
      { beat: 12, lanes: [0, 1] }, { beat: 13, lanes: [2] }, { beat: 13.5, lanes: [1] },
      { beat: 14, lanes: [0, 2] }, { beat: 15, lanes: [1, 2] }, { beat: 15.5, lanes: [0] },
    ],
  };

  const LIBRARY = [TRACK_01];
  function registerTrack(track) {
    normalizeBeatMap(track, 3); // validate before accepting
    const i = LIBRARY.findIndex((t) => t.id === track.id);
    if (i >= 0) LIBRARY[i] = track; else LIBRARY.push(track);
    return track;
  }

  window.BBRhythm = { RhythmEngine, RhythmSynth, LIBRARY, registerTrack, fromSequencerGrid, normalizeBeatMap, noteToMidi, SCALES, DEFAULT_LANE_MAP };
})();
