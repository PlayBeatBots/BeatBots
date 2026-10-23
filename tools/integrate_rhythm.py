#!/usr/bin/env python3
"""One-time integration of the BeatMap rhythm engine (beatbots-rhythm.js) into site-src/index.html.
Replaces the random-spawn arcade with chart-driven, audio-clock-synced gameplay. All-or-nothing.
Usage: integrate_rhythm.py <index.html>
"""
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f"expected {count} match(es), found {n}: {old[:90]!r}")
    s = s.replace(old, new)


def between(start, end, new):
    global s
    if s.count(start) != 1:
        sys.exit(f"start marker not unique: {start[:80]!r}")
    a = s.find(start)
    b = s.find(end, a)
    if b < 0:
        sys.exit(f"end marker not found: {end[:80]!r}")
    s = s[:a] + new + s[b:]


# 1. load the rhythm engine after the audio engine
rep('<script src="beatbots-audio.js"></script>',
    '<script src="beatbots-audio.js"></script>\n  <script src="beatbots-rhythm.js"></script>')

# 2. song picker is filled from the BeatMap library at runtime
between('<select id="arcade-song-select" class="bg-bass-card text-slate-200 border border-bass-border rounded px-2 py-1 text-xs">',
        '</select>',
        '<select id="arcade-song-select" class="bg-bass-card text-slate-200 border border-bass-border rounded px-2 py-1 text-xs">\n'
        '                <option value="track01">01: Intergalactic Cypher</option>\n              ')

# 3. start: load the chosen BeatMap and run it on the audio clock
between("    function startArcadeGame() {", "    function endArcadeGame() {", r"""    // ---- BeatMap library: Track 01 + the five clan presets + the player's own station loop ----
    let rhythm = null;
    const ARCADE_TRAVEL = { standard: 1.9, turbo: 1.4, hyper: 1.0 }; // seconds a note takes to fall
    const PRESET_TRACKS = [
      { key: 'bboy', title: 'B-Boy Funk Break', bpm: 96, clan: 'bboy', scale: { root: 'A4', mode: 'minorPentatonic' }, swing: 22,
        models: ['punch', 'crisp', 'closed', 'cowbell', 'sine', 'soul', 'hey', 'tom'] },
      { key: 'dub', title: '140 Deep Dub Siren', bpm: 140, clan: 'dub', scale: { root: 'G4', mode: 'minorPentatonic' }, swing: 8,
        models: ['sub', 'rim', 'open', 'wood', 'reese', 'flute', 'drop', 'laser'] },
      { key: 'soul', title: 'Electro-Soul Sunrise', bpm: 90, clan: 'alchemist', scale: { root: 'F4', mode: 'majorPentatonic' }, swing: 16,
        models: ['sub', 'clap', 'shaker', 'bongo', 'sine', 'soul', 'yeah', 'whoosh'] },
      { key: 'metal', title: 'Industrial Distortion', bpm: 105, clan: 'industrial', scale: { root: 'D4', mode: 'phrygian' }, swing: 0,
        models: ['hard', 'crisp', 'closed', 'cowbell', 'acid', 'saw', 'hey', 'laser'] },
      { key: 'poly', title: 'Odd-Meter Polyrhythm', bpm: 138, clan: 'biomech', scale: { root: 'D4', mode: 'minor' }, swing: 0,
        models: ['sub', 'rim', 'closed', 'bongo', 'reese', 'flute', 'drop', 'tom'] },
    ];
    function buildArcadeLibrary() {
      PRESET_TRACKS.forEach((p, i) => {
        try {
          BBRhythm.registerTrack(Object.assign(
            BBRhythm.fromSequencerGrid(PRESETS[p.key], { id: `preset-${p.key}`, title: p.title, artist: 'BeatBots', bpm: p.bpm, clan: p.clan, scale: p.scale, swing: p.swing, models: p.models }),
            { bars: 1 }));
        } catch (e) { console.warn('preset track skipped', p.key, e); }
      });
      const sel = document.getElementById('arcade-song-select');
      if (!sel) return;
      sel.innerHTML = '';
      BBRhythm.LIBRARY.forEach((t, i) => {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = `${String(i + 1).padStart(2, '0')}: ${t.title.replace(/ \(Track 01\)$/, '')}`;
        sel.appendChild(o);
      });
      const mine = document.createElement('option');
      mine.value = 'station'; mine.textContent = `${String(BBRhythm.LIBRARY.length + 1).padStart(2, '0')}: Your Station Loop`;
      sel.appendChild(mine);
    }

    // Sequencer-to-Arcade bridge: the current 16-step grid as a BeatMap
    function exportGridToBeatMap() {
      const models = Array.from({ length: NUM_TRACKS }, (_, t) => {
        const sel = document.querySelector(`.track-model-select[data-track="${t}"]`);
        return sel ? sel.value : 'default';
      });
      const clanScale = { bboy: 'A4', dub: 'G4', alchemist: 'F4', industrial: 'D4', biomech: 'D4' };
      return BBRhythm.fromSequencerGrid(pattern, {
        title: 'Your Station Loop', bpm, swing: swingPercent, clan: activeClanKey, models, mutes: trackMutes,
        scale: { root: clanScale[activeClanKey] || 'A4', mode: activeClanKey === 'alchemist' ? 'majorPentatonic' : 'minorPentatonic' },
      });
    }
    window.exportGridToBeatMap = exportGridToBeatMap;

    function selectedArcadeTrack() {
      const v = document.getElementById('arcade-song-select').value;
      if (v === 'station') return exportGridToBeatMap();
      return BBRhythm.LIBRARY.find((t) => t.id === v) || BBRhythm.LIBRARY[0];
    }

    const laneFlash = [0, 0, 0];

    function startArcadeGame() {
      initAudio();
      let track;
      try {
        track = selectedArcadeTrack();
        rhythm = rhythm || new BBRhythm.RhythmEngine({ getEngine: () => bbEngine });
        rhythm.stop();
        const info = rhythm.loadBeatMap(track);
        // whole loops only, close to the 45 s round
        arcadeRoundSeconds = Math.max(1, Math.round(45 / info.length)) * info.length;
      } catch (e) {
        alert(e.message);
        return;
      }
      document.getElementById('arcade-overlay').classList.add('hidden');
      document.getElementById('overlay-pre-game').classList.add('hidden');
      document.getElementById('overlay-post-game').classList.add('hidden');

      score = 0;
      comboStreak = 0;
      maxCombo = 0;
      totalNotesSpawned = 0;
      totalNotesHit = 0;
      botHP = 100;
      roundTimeRemaining = arcadeRoundSeconds;
      activeNotes = [];
      if (track.clan) bbEngine.setClan(track.clan);

      const diff = document.getElementById('arcade-diff-select').value;
      rhythm.start({
        travelTime: ARCADE_TRAVEL[diff] || 1.9,
        duration: arcadeRoundSeconds,
        onMiss: () => {
          comboStreak = 0;
          botHP = Math.max(0, botHP - 5);
          updateArcadeHUD();
        },
        onEnd: () => { if (isArcadeRunning) endArcadeGame(); },
      });
      isArcadeRunning = true;
      clearInterval(arcadeTimer);
      updateArcadeHUD();
      requestAnimationFrame(arcadeLoop);
    }

""")

# 4. end: stop the chart, restore the page's clan voicing, use chart stats
rep("""    function endArcadeGame() {
      isArcadeRunning = false;
      clearInterval(arcadeTimer);
""", """    function endArcadeGame() {
      isArcadeRunning = false;
      clearInterval(arcadeTimer);
      if (rhythm) {
        rhythm.stop();
        totalNotesSpawned = rhythm.stats ? rhythm.stats.notes : totalNotesSpawned;
        totalNotesHit = rhythm.stats ? rhythm.stats.hits : totalNotesHit;
      }
      if (bbEngine) bbEngine.setClan(activeClanKey);
""")

# 5. hits play the pluck (from the engine); only misses get the UI buzz
rep("      uiSound(/MISS/.test(text) ? 'miss' : 'hit', { combo: comboStreak });",
    "      if (/MISS/.test(text)) uiSound('miss');")

# 6. judging + drawing driven by the chart and the audio clock
between("    function checkHit(laneIdx) {",
        "    // ==========================================\n    // 5. BEATBOT ARMORY",
        r"""    const JUDGE_POINTS = { perfect: 50, great: 35, good: 20 };
    const JUDGE_COLOR = { perfect: 'text-bass-toxic', great: 'text-bass-cyan', good: 'text-bass-amber' };

    function checkHit(laneIdx) {
      if (!isArcadeRunning || !rhythm) return;
      initAudio();
      laneFlash[laneIdx] = performance.now();
      const r = rhythm.hit(laneIdx);
      if (r) {
        totalNotesHit++;
        comboStreak++;
        maxCombo = Math.max(maxCombo, comboStreak);
        const mult = comboStreak >= 20 ? 8 : comboStreak >= 10 ? 4 : comboStreak >= 5 ? 2 : 1;
        const pts = JUDGE_POINTS[r.judgement] * mult;
        score += pts;
        botHP = Math.min(100, botHP + (r.judgement === 'perfect' ? 2.5 : 1.5));
        triggerHitFeedback(comboStreak >= 10 ? `HYPER STREAK! +${pts}` : `${r.judgement.toUpperCase()}!`, JUDGE_COLOR[r.judgement]);
      } else {
        // tapped with nothing in the window
        comboStreak = 0;
        botHP = Math.max(0, botHP - 4);
        triggerHitFeedback('MISS!', 'text-bass-crimson');
      }
      updateArcadeHUD();
    }

    const HIT_Y = 340;
    const LANE_COLORS = ['#00FF87', '#06B6D4', '#FFB020'];
    function arcadeLoop() {
      if (!isArcadeRunning || !rhythm) return;
      const f = rhythm.frame();
      const W = canvas.width, H = canvas.height;

      ctx.fillStyle = '#06080C';
      ctx.fillRect(0, 0, W, H);

      // scrolling beat grid (bar lines brighter)
      const c = rhythm.chart, spb = 60 / c.bpm;
      const firstBeat = Math.floor((f.time - 0.4) / spb);
      for (let b = firstBeat; b < firstBeat + Math.ceil(rhythm.travelTime / spb) + 3; b++) {
        const y = (1 - (b * spb - f.time) / rhythm.travelTime) * HIT_Y;
        if (y < 0 || y > H) continue;
        ctx.strokeStyle = b % c.beatsPerBar === 0 ? '#334155' : '#141B26';
        ctx.lineWidth = b % c.beatsPerBar === 0 ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // lane dividers + press flash
      const now = performance.now();
      for (let l = 0; l < 3; l++) {
        const a = Math.max(0, 1 - (now - laneFlash[l]) / 140);
        if (a > 0) {
          ctx.fillStyle = LANE_COLORS[l] + Math.round(a * 40).toString(16).padStart(2, '0');
          ctx.fillRect(LANE_COORDS[l] - 100, 0, 200, H);
        }
      }
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(200, 0); ctx.lineTo(200, H);
      ctx.moveTo(400, 0); ctx.lineTo(400, H);
      ctx.stroke();

      // strike line
      ctx.strokeStyle = '#00FF87';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, HIT_Y); ctx.lineTo(W, HIT_Y); ctx.stroke();

      // chord connectors
      const chords = {};
      f.notes.forEach((n) => { if (n.chordId && !n.missed) (chords[n.chordId] = chords[n.chordId] || []).push(n); });
      Object.values(chords).forEach((g) => {
        if (g.length < 2) return;
        const xs = g.map((n) => LANE_COORDS[n.lane]);
        const y = g[0].progress * HIT_Y;
        ctx.strokeStyle = '#E2E8F0aa'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(Math.min(...xs), y); ctx.lineTo(Math.max(...xs), y); ctx.stroke();
      });

      // notes
      f.notes.forEach((n) => {
        const x = LANE_COORDS[n.lane];
        const y = n.progress * HIT_Y;
        ctx.fillStyle = n.missed ? '#FF2E5466' : LANE_COLORS[n.lane];
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = n.missed ? 0 : 12;
        ctx.beginPath();
        ctx.roundRect(x - 45, y - 12, 90, 24, 6);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      roundTimeRemaining = Math.ceil(f.remaining);
      document.getElementById('arcade-time-bar').style.width = `${(f.remaining / f.duration) * 100}%`;

      if (botHP <= 0) { endArcadeGame(); return; }
      requestAnimationFrame(arcadeLoop);
    }

""")

# 7. inputs: ignore key auto-repeat; touch buttons fire on press (not release); tap lanes on the canvas
for k, lane in (("'d' || e.key === 'D'", 0), ("'f' || e.key === 'F'", 1), ("'j' || e.key === 'J'", 2)):
    rep(f"        else if (e.key === {k}) checkHit({lane});",
        f"        else if (!e.repeat && (e.key === {k})) checkHit({lane});")
for lane in (0, 1, 2):
    rep(f"      document.getElementById('lane-touch-{lane}').addEventListener('click', () => checkHit({lane}));",
        f"      document.getElementById('lane-touch-{lane}').addEventListener('pointerdown', (e) => {{ e.preventDefault(); checkHit({lane}); }});")
rep("      document.getElementById('start-arcade-btn').addEventListener('click', startArcadeGame);",
    """      buildArcadeLibrary();
      canvas.addEventListener('pointerdown', (e) => {
        if (!isArcadeRunning) return;
        const r = canvas.getBoundingClientRect();
        checkHit(Math.min(2, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 3))));
      });
      document.getElementById('start-arcade-btn').addEventListener('click', startArcadeGame);""")

open(path, "w", encoding="utf-8").write(s)
print("rhythm engine integrated into", path)
