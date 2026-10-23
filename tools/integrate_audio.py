#!/usr/bin/env python3
"""One-time integration of the v4 audio engine (beatbots-audio.js) into site-src/index.html.
Every edit must match exactly once; otherwise nothing is written.
Usage: integrate_audio.py <index.html>
"""
import re
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
    """Replace from `start` (inclusive) to `end` (exclusive)."""
    global s
    a = s.find(start)
    if a < 0 or s.count(start) != 1:
        sys.exit(f"start marker not unique: {start[:80]!r}")
    b = s.find(end, a)
    if b < 0:
        sys.exit(f"end marker not found: {end[:80]!r}")
    s = s[:a] + new + s[b:]


# 1. Load the engine before the page logic
rep("<!-- SCRIPT LOGIC", '<script src="beatbots-audio.js"></script>\n  <!-- SCRIPT LOGIC')

# 2. Replace the old oscillator engine with a thin layer over BBAudio (same function names)
between(
    "    // ==========================================\n    // 1. WEB AUDIO SYNTHESIZER ENGINE v3.0",
    "    // ==========================================\n    // 2. UPGRADED 8-TRACK SEQUENCER ENGINE",
    r"""    // ==========================================
    // 1. AUDIO ENGINE v4 — procedural synthesis lives in beatbots-audio.js
    // ==========================================
    let audioCtx = null;
    let bbEngine = null;
    // Node handles kept for the existing slider handlers
    let masterGain = null, biquadFilter = null, highpassFilter = null;
    let delayNode = null, delayFeedback = null, waveShaper = null;
    let isDelayOn = true;
    let isDistOn = false;
    let isTapeSaturationOn = true;
    let masterDrive = 15;

    // Master filter slider is 0-100, mapped exponentially to 150 Hz - 20 kHz
    function filterSliderHz(v) { return Math.round(150 * Math.pow(20000 / 150, v / 100)); }
    function formatHz(hz) { return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}kHz` : `${hz}Hz`; }

    function initAudio() {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC({ latencyHint: 'interactive' });
        bbEngine = window.BBAudio.createEngine(audioCtx);
        window.__bbEngine = bbEngine;
        const N = bbEngine.nodes;
        masterGain = N.master; biquadFilter = N.lowpass; highpassFilter = N.highpass;
        delayNode = N.delay; delayFeedback = N.dlyFb; waveShaper = N.drive;
        // pick up the current state of the controls
        bbEngine.setTempo(bpm);
        bbEngine.setClan(activeClanKey);
        bbEngine.setDelayOn(isDelayOn);
        bbEngine.setDrive(isDistOn, masterDrive);
        bbEngine.setTape(isTapeSaturationOn);
        const fs = document.getElementById('filter-slider');
        if (fs) bbEngine.setLowpass(filterSliderHz(parseInt(fs.value, 10)));
        const hs = document.getElementById('hpf-slider');
        if (hs) bbEngine.setHighpass(parseInt(hs.value, 10));
        const ds = document.getElementById('delay-time-slider');
        if (ds) bbEngine.setDelayTime(parseInt(ds.value, 10) / 1000);
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    // Unlock audio on the first interaction so UI sounds work right away
    document.addEventListener('pointerdown', () => initAudio(), { once: true, capture: true });

    function uiSound(type, opts) {
      if (bbEngine && audioCtx && audioCtx.state === 'running') bbEngine.ui(type, opts);
    }

    function updateDistortionCurve(amount) {
      if (bbEngine) bbEngine.setDrive(isDistOn, amount);
    }

    // 8 instrument channels (names kept for the rest of the page)
    function play808Kick(time = 0, model = 'sub', step = null) { if (!bbEngine) initAudio(); bbEngine.kick(time, model, { step }); }
    function playSnare(time = 0, model = 'crisp', step = null) { if (!bbEngine) initAudio(); bbEngine.snare(time, model, { step }); }
    function playHiHat(time = 0, model = 'closed', step = null) { if (!bbEngine) initAudio(); bbEngine.hat(time, model, { step }); }
    function playPerc(time = 0, model = 'cowbell', step = null) { if (!bbEngine) initAudio(); bbEngine.percussion(time, model, { step }); }
    function playSubSynth(time = 0, model = 'sine', freq = 50, step = null) { if (!bbEngine) initAudio(); bbEngine.bass(time, model, { step }); }
    function playSynthChord(time = 0, model = 'soul', step = null) { if (!bbEngine) initAudio(); bbEngine.chord(time, model, { step }); }
    function playVocalStab(time = 0, model = 'hey', step = null) { if (!bbEngine) initAudio(); bbEngine.vocal(time, model, { step }); }
    function playGlitchTom(time = 0, model = 'tom', step = null) { if (!bbEngine) initAudio(); bbEngine.glitch(time, model, { step }); }

    // Playable Melodic Micro-Keyboard Engine
    let currentOctave = 3;
    function playKeyboardNote(freq) {
      initAudio();
      const preset = document.getElementById('synth-lab-preset').value;
      bbEngine.keyNote(freq, preset);
    }

    // Performance Launchpad FX
    function triggerFX(type) {
      initAudio();
      bbEngine.fx(type);
    }

    // Relay clicks for small toggle-style buttons
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest(
        '.track-mute-btn, .track-solo-btn, .pattern-bank-btn, .preset-btn, #seq-clear-btn, #seq-random-btn, #tap-tempo-btn, #toggle-crt-btn'
      );
      if (el) uiSound('click');
    }, true);

""",
)

# 3. Track dispatch passes the step so bass/chords follow the clan's key and bassline
between(
    "    function playTrackSound(trackIdx, time = 0) {",
    "    function stepSequencer() {",
    """    function playTrackSound(trackIdx, time = 0, step = null) {
      const anySolo = trackSolos.some(Boolean);
      if (anySolo && !trackSolos[trackIdx]) return;
      if (trackMutes[trackIdx]) return;
      if (!bbEngine) initAudio();

      const sel = document.querySelector(`.track-model-select[data-track="${trackIdx}"]`);
      const model = sel ? sel.value : 'default';
      bbEngine.playTrack(trackIdx, time, model, step == null ? currentStep : step);
    }

""",
)

# 4. Sample-accurate lookahead clock (replaces setInterval stepping); swing + live tempo
between(
    "    function stepSequencer() {",
    "    // Keyboard Synth Lab Builder",
    """    // Lookahead scheduler: a 25 ms timer queues notes ~120 ms ahead on the audio clock,
    // so timing stays tight even when the page is busy.
    const SCHED_LOOKAHEAD = 0.12;
    let nextStepTime = 0;

    function highlightStep(step) {
      document.querySelectorAll('.step-current').forEach(el => el.classList.remove('step-current'));
      for (let t = 0; t < NUM_TRACKS; t++) {
        const row = document.getElementById(`grid-track-${t}`);
        if (row && row.children[step]) row.children[step].classList.add('step-current');
      }
    }

    function stepSequencer() {
      if (!audioCtx) return;
      const stepDur = 60 / bpm / 4;
      bbEngine.setTempo(bpm);
      while (nextStepTime < audioCtx.currentTime + SCHED_LOOKAHEAD) {
        const step = currentStep;
        const swing = step % 2 ? stepDur * (swingPercent / 100) * 0.66 : 0;
        const time = nextStepTime + swing;
        for (let t = 0; t < NUM_TRACKS; t++) {
          if (pattern[t][step]) playTrackSound(t, time, step);
        }
        const wait = Math.max(0, (time - audioCtx.currentTime) * 1000);
        setTimeout(() => { if (isSeqPlaying) highlightStep(step); }, wait);
        nextStepTime += stepDur;
        currentStep = (currentStep + 1) % NUM_STEPS;
      }
    }

    function toggleSequencer() {
      initAudio();
      isSeqPlaying = !isSeqPlaying;
      const btn = document.getElementById('seq-play-btn');
      const text = document.getElementById('play-btn-text');

      if (isSeqPlaying) {
        btn.classList.replace('bg-bass-toxic', 'bg-bass-amber');
        text.textContent = 'STOP PATTERN';
        currentStep = 0;
        nextStepTime = audioCtx.currentTime + 0.06;
        stepSequencer();
        seqInterval = setInterval(stepSequencer, 25);
      } else {
        btn.classList.replace('bg-bass-amber', 'bg-bass-toxic');
        text.textContent = 'PLAY PATTERN';
        clearInterval(seqInterval);
        document.querySelectorAll('.step-current').forEach(el => el.classList.remove('step-current'));
        currentStep = 0;
      }
    }

""",
)

# Tempo changes no longer need the clock restarted (it reads bpm every tick)
s, n = re.subn(
    r"clearInterval\(seqInterval\);\s*seqInterval = setInterval\(stepSequencer, \(60000 / bpm\) / 4\);",
    "/* the lookahead clock follows bpm live */",
    s,
)
if n != 3:
    sys.exit(f"expected 3 tempo-restart blocks, found {n}")

# 5. Step buttons: preview with the right bassline note; soft tick when switching a step off
rep("""            if (pattern[t][s]) {
              playTrackSound(t);
            }""", """            if (pattern[t][s]) {
              playTrackSound(t, 0, s);
            } else {
              uiSound('step');
            }""")

# 6. Clan switching re-voices the mix and plays the servo whir
rep("""      const clan = CLAN_ASSETS[key];
      if (!clan) return;
""", """      const clan = CLAN_ASSETS[key];
      if (!clan) return;
      if (bbEngine) bbEngine.setClan(key);
      uiSound('servo');
""")

# 7. FX toggles talk to the engine
rep("if (delayFeedback) delayFeedback.gain.setValueAtTime(isDelayOn ? 0.35 : 0, audioCtx ? audioCtx.currentTime : 0);",
    "if (bbEngine) bbEngine.setDelayOn(isDelayOn);\n          uiSound(isDelayOn ? 'on' : 'off');")
rep("""          isDistOn = !isDistOn;
          updateDistortionCurve(masterDrive);""", """          isDistOn = !isDistOn;
          updateDistortionCurve(masterDrive);
          uiSound(isDistOn ? 'on' : 'off');""")
rep("""        isTapeSaturationOn = !isTapeSaturationOn;
""", """        isTapeSaturationOn = !isTapeSaturationOn;
        if (bbEngine) bbEngine.setTape(isTapeSaturationOn);
        uiSound(isTapeSaturationOn ? 'on' : 'off');
""")

# 8. Master filter: full range, exponential sweep, opens fully by default
rep('<span id="filter-val" class="text-bass-cyan font-bold">2800Hz</span>',
    '<span id="filter-val" class="text-bass-cyan font-bold">20kHz</span>')
rep('<input id="filter-slider" type="range" min="150" max="4000" value="2800"',
    '<input id="filter-slider" type="range" min="0" max="100" value="100"')
rep("""        const val = parseInt(e.target.value, 10);
        document.getElementById('filter-val').textContent = `${val}Hz`;
        if (biquadFilter && audioCtx) {
          biquadFilter.frequency.setValueAtTime(val, audioCtx.currentTime);
        }""", """        const val = filterSliderHz(parseInt(e.target.value, 10));
        document.getElementById('filter-val').textContent = formatHz(val);
        if (bbEngine) bbEngine.setLowpass(val);""")

# 9. Arcade feedback sounds
rep("""    function triggerHitFeedback(text, color = 'text-bass-toxic') {
""", """    function triggerHitFeedback(text, color = 'text-bass-toxic') {
      uiSound(/MISS/.test(text) ? 'miss' : 'hit', { combo: comboStreak });
""")

# 10. WAV export renders through the same engine (stereo, effects, clan voicing)
between(
    "            const sampleRate = 44100;",
    "            const wavUrl = URL.createObjectURL(wavBlob);",
    """            const models = Array.from({ length: NUM_TRACKS }, (_, t) => {
              const sel = document.querySelector(`.track-model-select[data-track="${t}"]`);
              return sel ? sel.value : 'default';
            });
            const renderedBuffer = await window.BBAudio.renderPattern({
              pattern, models, mutes: trackMutes, solos: trackSolos,
              bpm, swing: swingPercent, clan: activeClanKey, bars: 2,
              settings: {
                hp: highpassFilter ? highpassFilter.frequency.value : 30,
                lp: biquadFilter ? biquadFilter.frequency.value : 20000,
                delayTime: delayNode ? delayNode.delayTime.value : 0.28,
                delayOn: isDelayOn, driveOn: isDistOn, drive: masterDrive, tapeOn: isTapeSaturationOn,
              },
            });
            const wavBlob = window.BBAudio.bufferToWav(renderedBuffer);
""",
)

open(path, "w", encoding="utf-8").write(s)
print("audio engine v4 integrated into", path)
