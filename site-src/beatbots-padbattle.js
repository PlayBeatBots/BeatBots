/*
 * BeatBots Beat Battle: a 4x4 sampler-pad rhythm battle on the Web Audio clock.
 *
 *   BBPadBattle.mount(document.getElementById('padbattle-root'), {
 *     getCtx: () => AudioContext,        // called inside a user gesture
 *     kitBase: 'kits/',                  // sample root (kits/<clan>/*.wav, kits/pads/*.wav)
 *     clans: CLAN_ASSETS,                // title, ability, atk/def/spd, editions[].img
 *     onRunningChange: (running) => {},  // page uses this to mute its own key handlers
 *     getHolderBot: () => null,          // later: { name, img, clan } for a wallet's NFT (cosmetic)
 *   });
 *
 * How it plays: every pad is a real sample. A rival bot plays a phrase (call), then you play it
 * back (response). Approach rings close on the pad at the moment to hit it. Your hits play the
 * sounds, so a clean run plays the full beat; misses leave holes and push the battle bar back.
 *
 * Song format (see SONGS below): bpm, swing, inst (sound sources), pads (16 roles -> label,
 * inst, note), parts (named N-bar blocks of 16-step strings per role), and an exchange order.
 * Step chars: X = accent, x = normal, o = ghost, '=' extends the previous note, '.' = rest.
 * For an original TecSupport track add `audio: 'tracks/<file>.mp3', audioOffset: <sec to bar 1>`:
 * the file then replaces the backing parts and the pads layer on top.
 */
(function () {
  'use strict';

  const ROLES = ['hat', 'shk', 'stab', 'crash', 'c1', 'c2', 'c3', 'c4', 'kick', 'snare', 'clap', 'ohat', 'b1', 'b2', 'b3', 'b4'];
  const KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
  const ROW_COLORS = ['#FF5FA2', '#2F7BFF', '#00E5FF', '#FF2BD6']; // fx, chords, drums, bass
  const PRIORITY = ['kick', 'snare', 'b1', 'b2', 'b3', 'b4', 'clap', 'c1', 'c2', 'c3', 'c4', 'ohat', 'stab', 'crash', 'shk', 'hat'];
  const DIFFS = {
    // win = timing-window multiplier, miss = bar push per miss, stray = penalise off-pattern taps
    easy: { label: 'EASY', pads: 2, rows: [2], roles: ['kick', 'snare'], approach: 1.7, maxSim: 1, off: 'none', gap: 0.3, tgap: 0.38, rival: 0.66, win: 1.35, miss: 0.9, stray: false, noGhosts: true },
    standard: { label: 'STANDARD', pads: 4, rows: [2], approach: 1.4, maxSim: 2, off: 'none', gap: 0.2, tgap: 0.24, rival: 0.76, win: 1.15, miss: 1.25, stray: false, noGhosts: true },
    turbo: { label: 'TURBO', pads: 8, rows: [2, 3], approach: 1.1, maxSim: 2, off: 'sparse', gap: 0.15, tgap: 0.15, rival: 0.86, win: 1, miss: 1.6, stray: true },
    hyper: { label: 'HYPER', pads: 16, rows: [0, 1, 2, 3], approach: 0.9, maxSim: 2, off: 'sparse', gap: 0.12, tgap: 0.11, rival: 0.92, win: 1, miss: 1.6, stray: true },
  };
  const padOn = (i, D) => D.rows.includes(Math.floor(i / 4)) && (!D.roles || D.roles.includes(ROLES[i]));
  const WIN = { perfect: 0.05, great: 0.095, good: 0.145 };
  const JUDGE = {
    perfect: { pts: 300, dmg: 2.0, meter: 7, color: '#00E5FF', text: 'PERFECT' },
    great: { pts: 200, dmg: 1.5, meter: 4, color: '#3CFFB4', text: 'GREAT' },
    good: { pts: 100, dmg: 0.9, meter: 2, color: '#2F7BFF', text: 'GOOD' },
  };
  const RIVAL_UNKNOWN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#0A1124"/><text x="40" y="54" font-family="monospace" font-size="40" font-weight="700" fill="#FF2BD6" text-anchor="middle">?</text></svg>');
  const CLAN_SHORT = { bboy: 'B-BOY', dub: 'DUB OP', alchemist: 'ALCHEMIST', industrial: 'MECHA', biomech: 'BIOMECH' };
  const ABILITY = {
    bboy: { name: 'SCRATCH FADER STUTTER', desc: 'Rival accuracy -15%' },
    dub: { name: '20 DOUBLE-BIN FRENZY', desc: 'Double damage' },
    alchemist: { name: 'HARMONIC RESONANCE', desc: '+25% points, heal' },
    industrial: { name: 'DISTORTION SURGE', desc: 'Misses absorbed' },
    biomech: { name: 'POLYRHYTHM TRANCE', desc: 'Double score' },
  };

  // ---------------------------------------------------------------------------
  // Songs: one original groove per clan, built from the CC0 clan kits + VCSL instruments
  // ---------------------------------------------------------------------------
  const R16 = (s) => s; // marker for 16-step strings (validated in compile)
  const SONGS = [
    {
      id: 'brooklyn-cypher', title: 'Brooklyn Cypher', clan: 'bboy', bpm: 92, swing: 0.16, crackle: true,
      inst: {
        kick: { s: 'bboy/kick_hard.wav', g: 1.0 },
        snare: { s: 'bboy/snare_crisp.wav', g: 0.8, rev: 0.12 },
        clap: { s: 'bboy/snare_clap.wav', g: 0.62, rev: 0.16 },
        ohat: { s: 'bboy/hat_open.wav', g: 0.4 },
        hat: { s: 'bboy/hat_closed.wav', g: 0.34 },
        shk: { s: 'bboy/hat_shaker.wav', g: 0.3 },
        horn: { m: 'horn', g: 0.42, rev: 0.2, rel: 0.12 },
        crash: { s: 'pads/crash_short.wav', g: 0.32, rev: 0.1 },
        keys: { m: 'piano', g: 0.24, rev: 0.22, rel: 0.3 },
        bass: { b: 'bboy/bass_808.wav', root: 31.31, g: 0.72 },
      },
      pads: {
        hat: { label: 'HAT', inst: 'hat' }, shk: { label: 'SHAKER', inst: 'shk' },
        stab: { label: 'HORNS', inst: 'horn', note: [52, 59] }, crash: { label: 'CRASH', inst: 'crash' },
        c1: { label: 'Am9', inst: 'keys', note: [55, 59, 60, 64] }, c2: { label: 'Fmaj9', inst: 'keys', note: [57, 60, 64, 67] },
        c3: { label: 'Dm9', inst: 'keys', note: [53, 57, 60, 64] }, c4: { label: 'E7#9', inst: 'keys', note: [56, 62, 67] },
        kick: { label: 'KICK', inst: 'kick' }, snare: { label: 'SNARE', inst: 'snare' },
        clap: { label: 'CLAP', inst: 'clap' }, ohat: { label: 'OPEN HAT', inst: 'ohat' },
        b1: { label: '808 A', inst: 'bass', note: 33 }, b2: { label: '808 F', inst: 'bass', note: 29 },
        b3: { label: '808 D', inst: 'bass', note: 38 }, b4: { label: '808 E', inst: 'bass', note: 40 },
      },
      parts: {
        intro: [
          { c1: 'x===============', hat: 'x.o.x.o.x.o.x.o.' },
          { c2: 'x===============', hat: 'x.o.x.o.x.o.x.o.', snare: '........o.o.o.xX' },
        ],
        A: [
          { kick: 'X......x..x.....', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.o.', c1: 'x=====....x=====', b1: 'X======x==x=====' },
          { kick: 'X......x..x..x..', snare: '....X.......X..o', hat: 'x.o.x.o.x.o.x...', ohat: '..............x.', c2: 'x=====....x=====', b2: 'X======x==x==x==' },
        ],
        B: [
          { kick: 'X......x..x.....', snare: '....X.......X...', clap: '............X...', hat: 'x.o.x.o.x.o.x.o.', shk: '..o...o...o...o.', crash: 'X...............', c3: 'x=====....x=====', b3: 'X======x==x=====' },
          { kick: 'X......x..x...x.', snare: '....X.......X...', clap: '............X...', hat: 'x.o.x.o.x.o.x.o.', shk: '..o...o...o...o.', stab: '..........x...x.', c4: 'x=====..........', b4: 'X======x==x===x=' },
        ],
        C: [
          { kick: 'X.....xX..x...x.', snare: '....X.......X...', clap: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo', crash: 'X...............', stab: 'x...............', c1: 'x=====....x=====', b1: 'X=====xX==x===x=' },
          { kick: 'X......x..x.x...', snare: '....X.......X.oo', clap: '....x.......x...', hat: 'xoxoxoxoxoxo....', ohat: '............x...', stab: '..........x...x.', c2: 'x=====....x=====', b2: 'X======x==x.x===' },
        ],
        outro: [
          { kick: 'X...............', crash: 'X...............', c1: 'x===============', b1: 'X===============' },
        ],
      },
      order: ['A', 'A', 'B', 'A', 'B', 'C'],
    },
    {
      id: 'double-bins', title: '20 Double-Bins', clan: 'dub', bpm: 70, bpmLabel: 140, swing: 0, delayNote: 0.75,
      inst: {
        kick: { s: 'dub/kick_punch.wav', g: 1.0 },
        snare: { s: 'dub/snare_clap.wav', g: 0.72, rev: 0.32 },
        clap: { s: 'dub/snare_crisp.wav', g: 0.5, rev: 0.3, dly: 0.35 },
        ohat: { s: 'dub/hat_open.wav', g: 0.32, dly: 0.15 },
        hat: { s: 'dub/hat_closed.wav', g: 0.34 },
        shk: { s: 'dub/perc_conga.wav', g: 0.42, rev: 0.15 },
        siren: { syn: 'siren', g: 0.22, dly: 0.55, rev: 0.25 },
        crash: { s: 'pads/crash.wav', g: 0.28, rev: 0.15 },
        keys: { m: 'piano', g: 0.22, rev: 0.25, dly: 0.5, rel: 0.08, dur: 0.16 },
        bass: { syn: 'reese', g: 0.5, wobble: 4, cutoff: 260, depth: 900 },
      },
      pads: {
        hat: { label: 'HAT', inst: 'hat' }, shk: { label: 'CONGA', inst: 'shk' },
        stab: { label: 'SIREN', inst: 'siren', note: 76 }, crash: { label: 'CRASH', inst: 'crash' },
        c1: { label: 'Gm', inst: 'keys', note: [55, 58, 62] }, c2: { label: 'Eb', inst: 'keys', note: [55, 58, 63] },
        c3: { label: 'Cm', inst: 'keys', note: [55, 60, 63] }, c4: { label: 'D', inst: 'keys', note: [54, 57, 62] },
        kick: { label: 'KICK', inst: 'kick' }, snare: { label: 'SNARE', inst: 'snare' },
        clap: { label: 'RIM', inst: 'clap' }, ohat: { label: 'OPEN HAT', inst: 'ohat' },
        b1: { label: 'SUB G', inst: 'bass', note: 31 }, b2: { label: 'SUB Eb', inst: 'bass', note: 27 },
        b3: { label: 'SUB C', inst: 'bass', note: 36 }, b4: { label: 'SUB D', inst: 'bass', note: 38 },
      },
      parts: {
        intro: [
          { hat: '..x...x...x...x.', c1: '..x.......x.....', stab: 'x...............', snare: '............o.oX' },
        ],
        A: [
          { kick: 'X.........X.....', snare: '....X.......X...', hat: '..x...x...x...x.', c1: '..x.......x.....', b1: 'X=======..X=====' },
          { kick: 'X.........X..x..', snare: '....X.......X...', hat: '..x...x.x.x...xx', c2: '..x.......x.....', b2: 'X=======..X==x==' },
        ],
        B: [
          { kick: 'X.........X.....', snare: '....X.......X...', hat: '..x...x...x...x.', shk: 'x..x..x.........', crash: 'X...............', stab: '........x.......', c3: '..x.......x.....', b3: 'X=======..X=====' },
          { kick: 'X.........X.....', snare: '....X.......X.oo', hat: '..x...x...x...x.', shk: 'x..x..x.........', c4: '..x.......x...x.', b4: 'X=======..X=====' },
        ],
        C: [
          { kick: 'X..x......X.....', snare: '....X.......X...', clap: '.......x.......x', hat: 'x.x.x.x.x.x.x.x.', ohat: '......x.......x.', crash: 'X...............', stab: 'x.......x.......', c1: '..x...x...x...x.', b1: 'X==x==..X=x=====' },
          { kick: 'X..x......X..x..', snare: '....X.......X...', clap: '.......x....x.x.', hat: 'x.x.x.x.x.x.x...', ohat: '......x.......x.', c2: '..x...x...x...x.', b4: 'X==x==..X=x==x==' },
        ],
        outro: [
          { kick: 'X...............', crash: 'X...............', stab: 'x...............', b1: 'X===============' },
        ],
      },
      order: ['A', 'B', 'A', 'B', 'C'],
    },
    {
      id: 'golden-hour', title: 'Golden Hour Groove', clan: 'alchemist', bpm: 88, swing: 0.22,
      inst: {
        kick: { s: 'alchemist/kick_punch.wav', g: 1.0 },
        snare: { s: 'alchemist/snare_crisp.wav', g: 0.62, rev: 0.2 },
        clap: { s: 'alchemist/snare_clap.wav', g: 0.55, rev: 0.22 },
        ohat: { s: 'alchemist/hat_open.wav', g: 0.3 },
        hat: { s: 'alchemist/hat_closed.wav', g: 0.32 },
        shk: { s: 'alchemist/hat_tamb.wav', g: 0.26 },
        horn: { m: 'horn', g: 0.4, rev: 0.25, rel: 0.12 },
        crash: { s: 'pads/crash_short.wav', g: 0.3, rev: 0.15 },
        keys: { m: 'vibes', g: 0.26, rev: 0.3, rel: 0.5 },
        bass: { b: 'bboy/bass_808.wav', root: 31.31, g: 0.68 },
      },
      pads: {
        hat: { label: 'HAT', inst: 'hat' }, shk: { label: 'TAMB', inst: 'shk' },
        stab: { label: 'HORNS', inst: 'horn', note: [57, 60, 65] }, crash: { label: 'CRASH', inst: 'crash' },
        c1: { label: 'Fmaj9', inst: 'keys', note: [57, 60, 64, 67] }, c2: { label: 'Em7', inst: 'keys', note: [55, 59, 62, 64] },
        c3: { label: 'Dm9', inst: 'keys', note: [53, 57, 60, 64] }, c4: { label: 'Bbmaj9', inst: 'keys', note: [57, 60, 62, 65] },
        kick: { label: 'KICK', inst: 'kick' }, snare: { label: 'SNARE', inst: 'snare' },
        clap: { label: 'CLAP', inst: 'clap' }, ohat: { label: 'OPEN HAT', inst: 'ohat' },
        b1: { label: '808 F', inst: 'bass', note: 29 }, b2: { label: '808 E', inst: 'bass', note: 28 },
        b3: { label: '808 D', inst: 'bass', note: 26 }, b4: { label: '808 Bb', inst: 'bass', note: 34 },
      },
      parts: {
        intro: [
          { c1: 'x=======x=======', shk: 'x.x.x.x.x.x.x.x.' },
          { c2: 'x=======x=======', shk: 'x.x.x.x.x.x.x.x.', kick: '..............x.' },
        ],
        A: [
          { kick: 'X.....x...x..x..', snare: '....x.......x...', hat: 'x.xox.xox.xox.xo', c1: 'x=====..x=======', b1: 'X=====x===x==x==' },
          { kick: 'X.....x...x.....', snare: '....x.......x..o', hat: 'x.xox.xox.xox.x.', ohat: '..............x.', c2: 'x=====..x=======', b2: 'X=====x===x=====' },
        ],
        B: [
          { kick: 'X.....x...x..x..', snare: '....x.......x...', clap: '....x.......x...', hat: 'x.xox.xox.xox.xo', shk: 'x.x.x.x.x.x.x.x.', crash: 'X...............', c3: 'x=====..x=======', b3: 'X=====x===x==x==' },
          { kick: 'X.....x...x.....', snare: '....x.......x...', clap: '....x.......x...', hat: 'x.xox.xox.xox.x.', shk: 'x.x.x.x.x.x.x.x.', stab: '......x.....x...', c4: 'x=====..x=======', b4: 'X=====x===x=====' },
        ],
        C: [
          { kick: 'X.....xX..x..x..', snare: '....x.......x...', clap: '....x.......x..x', hat: 'xoxoxoxoxoxoxoxo', crash: 'X...............', stab: 'x.........x.....', c1: 'x=====..x===x===', b1: 'X=====xX==x==x==' },
          { kick: 'X.....x...x.x...', snare: '....x.......x.oo', clap: '....x.......x...', hat: 'xoxoxoxoxoxo....', ohat: '............x...', stab: '......x.....x...', c4: 'x=====..x===x===', b4: 'X=====x===x.x===' },
        ],
        outro: [
          { kick: 'X...............', crash: 'X...............', c1: 'x===============', b1: 'X===============' },
        ],
      },
      order: ['A', 'A', 'B', 'A', 'B', 'C'],
    },
    {
      id: 'steel-foundry', title: 'Steel Foundry', clan: 'industrial', bpm: 100, swing: 0,
      inst: {
        kick: { s: 'industrial/kick_punch.wav', g: 1.0 },
        snare: { s: 'industrial/snare_crisp.wav', g: 0.72, rev: 0.18 },
        clap: { s: 'industrial/snare_anvil.wav', g: 0.5, rev: 0.12 },
        ohat: { s: 'industrial/perc_anvil.wav', g: 0.38, rev: 0.2 },
        hat: { s: 'industrial/hat_closed.wav', g: 0.32 },
        shk: { s: 'industrial/perc_brake.wav', g: 0.34 },
        impact: { s: 'pads/timpani.wav', g: 0.62, rev: 0.25 },
        crash: { s: 'pads/crash.wav', g: 0.3, rev: 0.12 },
        power: { syn: 'power', g: 0.2, rev: 0.12 },
        bass: { syn: 'reese', g: 0.42, wobble: 0, cutoff: 900, drive: 6 },
      },
      pads: {
        hat: { label: 'HAT', inst: 'hat' }, shk: { label: 'BRAKE', inst: 'shk' },
        stab: { label: 'IMPACT', inst: 'impact' }, crash: { label: 'CRASH', inst: 'crash' },
        c1: { label: 'D5', inst: 'power', note: [50, 57, 62] }, c2: { label: 'Eb5', inst: 'power', note: [51, 58, 63] },
        c3: { label: 'F5', inst: 'power', note: [53, 60, 65] }, c4: { label: 'C5', inst: 'power', note: [48, 55, 60] },
        kick: { label: 'KICK', inst: 'kick' }, snare: { label: 'SNARE', inst: 'snare' },
        clap: { label: 'ANVIL SN', inst: 'clap' }, ohat: { label: 'ANVIL', inst: 'ohat' },
        b1: { label: 'BASS D', inst: 'bass', note: 38 }, b2: { label: 'BASS Eb', inst: 'bass', note: 39 },
        b3: { label: 'BASS F', inst: 'bass', note: 41 }, b4: { label: 'BASS C', inst: 'bass', note: 36 },
      },
      parts: {
        intro: [
          { hat: 'x.x.x.x.x.x.x.x.', stab: 'X...............', c1: 'x===============' },
          { hat: 'x.x.x.x.x.x.x.x.', kick: 'X...X...X...X...', snare: '............xxXX' },
        ],
        A: [
          { kick: 'X.x...X.X.x...x.', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', c1: 'x=..x=..x=..x=..', b1: 'X=x...X=X=x...x=' },
          { kick: 'X.x...X.X.x.X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............x.', c2: 'x=..x=..x=......', b2: 'X=x...X=X=x.X===' },
        ],
        B: [
          { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', shk: '..x...x...x...x.', crash: 'X...............', c3: 'x===....x===....', b3: 'X===X===X===X===' },
          { kick: 'X...X...X...X.x.', snare: '....X.......X...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', shk: '..x...x...x...x.', stab: '........X.......', c4: 'x===....x===....', b4: 'X===X===X===X.x.' },
        ],
        C: [
          { kick: 'XxX.X.xXX.x.X.x.', snare: '....X.......X...', clap: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx', crash: 'X...............', ohat: '......x.......x.', c1: 'x=.x..x=x=.x..x=', b1: 'XxX.X.xXX.x.X.x.' },
          { kick: 'XxX.X.xXX.x.X...', snare: '....X.......X.xx', clap: '....X.......X...', hat: 'xxxxxxxxxxxx....', stab: '............X...', c2: 'x=.x..x=x=.x....', b2: 'XxX.X.xXX.x.X===' },
        ],
        outro: [
          { kick: 'X...............', crash: 'X...............', stab: 'X...............', c1: 'x===============', b1: 'X===============' },
        ],
      },
      order: ['A', 'A', 'B', 'A', 'B', 'C'],
    },
    {
      id: 'spiral-rite', title: 'Golden Spiral Rite', clan: 'biomech', bpm: 104, swing: 0.06,
      inst: {
        kick: { s: 'biomech/kick_frame.wav', g: 1.0 },
        snare: { s: 'biomech/snare_darbuka.wav', g: 0.72, rev: 0.2 },
        clap: { s: 'biomech/snare_darbuka2.wav', g: 0.6, rev: 0.2 },
        ohat: { s: 'biomech/perc_slit.wav', g: 0.5, rev: 0.25 },
        hat: { s: 'biomech/hat_closed.wav', g: 0.3 },
        shk: { s: 'biomech/perc_bongo.wav', g: 0.42, rev: 0.15 },
        gong: { s: 'biomech/fx_gong.wav', g: 0.42, rev: 0.3, dur: 2.6 },
        crash: { s: 'pads/timpani.wav', g: 0.55, rev: 0.3 },
        keys: { m: 'vibes', g: 0.27, rev: 0.35, dly: 0.18, rel: 0.4 },
        bass: { b: 'bboy/bass_808.wav', root: 31.31, g: 0.66 },
      },
      pads: {
        hat: { label: 'HAT', inst: 'hat' }, shk: { label: 'BONGO', inst: 'shk' },
        stab: { label: 'GONG', inst: 'gong' }, crash: { label: 'TIMPANI', inst: 'crash' },
        c1: { label: 'Dm', inst: 'keys', note: [57, 62, 65, 69] }, c2: { label: 'C', inst: 'keys', note: [55, 60, 64, 67] },
        c3: { label: 'Bb', inst: 'keys', note: [58, 62, 65, 70] }, c4: { label: 'A', inst: 'keys', note: [57, 61, 64, 69] },
        kick: { label: 'FRAME', inst: 'kick' }, snare: { label: 'DOUM', inst: 'snare' },
        clap: { label: 'TEK', inst: 'clap' }, ohat: { label: 'SLIT', inst: 'ohat' },
        b1: { label: '808 D', inst: 'bass', note: 38 }, b2: { label: '808 C', inst: 'bass', note: 36 },
        b3: { label: '808 Bb', inst: 'bass', note: 34 }, b4: { label: '808 A', inst: 'bass', note: 33 },
      },
      parts: {
        intro: [
          { stab: 'X...............', c1: 'x=====x=====x===', shk: '..x..x..x..x..x.' },
          { c1: 'x=====x=====x===', shk: '..x..x..x..x..x.', clap: '..........x.x.xX' },
        ],
        A: [
          { kick: 'X..x..x...X..x..', snare: '....X.......X...', clap: '..x....x..x....x', hat: 'x.x.x.x.x.x.x.x.', c1: 'x=====x=====x===', b1: 'X==x==x===X==x==' },
          { kick: 'X..x..x...X..x..', snare: '....X.......X...', clap: '..x....x..x..x.x', hat: 'x.x.x.x.x.x.x.x.', ohat: '......x.......x.', c2: 'x=====x=====x===', b2: 'X==x==x===X==x==' },
        ],
        B: [
          { kick: 'X..x..x...X..x..', snare: '....X.......X...', clap: '..x....x..x....x', hat: 'x.x.x.x.x.x.x.x.', shk: 'x..x..x..x..x...', stab: 'X...............', c3: 'x=====x=====x===', b3: 'X==x==x===X==x==' },
          { kick: 'X..x..x...X..x..', snare: '....X.......X...', clap: '..x....x..x..xxx', hat: 'x.x.x.x.x.x.x.x.', shk: 'x..x..x..x..x...', crash: '........X.......', c4: 'x=====x=====x===', b4: 'X==x==x===X==x==' },
        ],
        C: [
          { kick: 'X..x..x.X..x..x.', snare: '....X.......X...', clap: '.xx..x.x.xx..x.x', hat: 'xxxxxxxxxxxxxxxx', ohat: '..x.....x.....x.', crash: 'X...............', c1: 'x==x==x==x==x=x=', b1: 'X..x..x.X..x..x.' },
          { kick: 'X..x..x.X..x..x.', snare: '....X.......X.xx', clap: '.xx..x.x.xx.....', hat: 'xxxxxxxxxxxx....', stab: '............X...', c4: 'x==x==x==x==x===', b4: 'X..x..x.X..x====' },
        ],
        outro: [
          { kick: 'X...............', stab: 'X...............', c1: 'x===============', b1: 'X===============' },
        ],
      },
      order: ['A', 'A', 'B', 'A', 'B', 'C'],
    },
  ];

  // ---------------------------------------------------------------------------
  // Compile a song for a difficulty: backing events, rival (call) notes, player (response) notes
  // ---------------------------------------------------------------------------
  const VEL = { X: 1, x: 0.8, o: 0.5 };
  function parseBar(bar, song, where) {
    const out = [];
    Object.keys(bar).forEach((role) => {
      const pad = ROLES.indexOf(role);
      if (pad < 0) throw new Error(`${where}: unknown pad role "${role}"`);
      if (!song.pads[role]) throw new Error(`${where}: song has no pad "${role}"`);
      const s = bar[role];
      if (typeof s !== 'string' || s.length !== 16) throw new Error(`${where}.${role}: needs 16 steps, got ${s && s.length}`);
      for (let i = 0; i < 16; i++) {
        const ch = s[i];
        if (ch === '.' || ch === '=') continue;
        if (!VEL[ch]) throw new Error(`${where}.${role}: bad step char "${ch}"`);
        let len = 1;
        while (i + len < 16 && s[i + len] === '=') len++;
        out.push({ step: i, pad, role, vel: VEL[ch], len });
      }
    });
    return out;
  }

  function compile(song, diffKey) {
    const D = DIFFS[diffKey] || DIFFS.standard;
    const spb = 60 / song.bpm, stepDur = spb / 4;
    const swing = song.swing || 0;
    const stepT = (s) => s * stepDur + (s % 2 ? swing * stepDur : 0);
    const charted = (pad) => padOn(pad, D);

    // pick which events in a part become notes (shared by the call and its response)
    function chartPart(evs) {
      const byStep = {};
      evs.forEach((e) => { (byStep[e.abs] = byStep[e.abs] || []).push(e); });
      const lastOnPad = {};
      let prevStepHad = -99, lastT = -9;
      Object.keys(byStep).map(Number).sort((a, b) => a - b).forEach((abs) => {
        const cand = byStep[abs].filter((e) => charted(e.pad))
          .sort((a, b) => PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role));
        const off = abs % 2 === 1;
        const tNow = abs * stepDur;
        let picked = 0;
        if (tNow - lastT < D.tgap) return; // keep a playable gap between hits
        cand.forEach((e) => {
          if (picked >= D.maxSim) return;
          if (off && D.off === 'none') return;
          if (off && D.off === 'sparse' && prevStepHad === abs - 1) return;
          if (D.noGhosts && e.vel < 0.6) return; // ghosts stay in the backing
          const t = e.abs * stepDur;
          if (lastOnPad[e.pad] != null && t - lastOnPad[e.pad] < D.gap) return;
          lastOnPad[e.pad] = t; e.note = true; picked++;
        });
        if (picked) { prevStepHad = abs; lastT = tNow; }
      });
    }

    const timeline = []; // phrases
    const backing = [], rival = [], player = [];
    let bar = 0;
    const addPart = (name, kind, ex) => {
      const part = song.parts[name];
      if (!part) throw new Error(`${song.id}: missing part "${name}"`);
      const evs = [];
      part.forEach((b, bi) => parseBar(b, song, `${song.id}.${name}[${bi}]`).forEach((e) => { e.abs = bi * 16 + e.step; evs.push(e); }));
      if (kind === 'call' || kind === 'resp') chartPart(evs);
      const t0 = bar * 4 * spb;
      evs.forEach((e) => {
        const ev = { t: t0 + Math.floor(e.abs / 16) * 16 * stepDur + stepT(e.abs % 16), pad: e.pad, vel: e.vel, dur: e.len * stepDur, ex };
        if (e.note && kind === 'call') rival.push(ev);
        else if (e.note && kind === 'resp') player.push(ev);
        else backing.push(ev);
      });
      timeline.push({ kind, part: name, ex, t0, t1: t0 + part.length * 4 * spb, beats: part.length * 4 });
      bar += part.length;
    };
    addPart('intro', 'intro', -1);
    song.order.forEach((p, ex) => { addPart(p, 'call', ex); addPart(p, 'resp', ex); });
    addPart('outro', 'outro', song.order.length);
    const byT = (a, b) => a.t - b.t;
    backing.sort(byT); rival.sort(byT); player.sort(byT);
    const respCount = timeline.filter((p) => p.kind === 'resp').length;
    return { song, diff: D, spb, stepDur, timeline, backing, rival, player, total: bar * 4 * spb, notesPerPhrase: player.length / respCount };
  }

  // ---------------------------------------------------------------------------
  // Audio: sampler + a few synths on their own bus (comp, reverb, dub delay, miss choke)
  // ---------------------------------------------------------------------------
  const TINY = 0.0001;
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function satCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }

  class PBAudio {
    constructor(ctx, base) {
      this.ctx = ctx; this.base = base; this.buf = {}; this.loads = {}; this.multi = null; this.mono = {};
      const c = ctx;
      this.bus = c.createGain();
      this.choke = c.createBiquadFilter(); this.choke.type = 'lowpass'; this.choke.frequency.value = 20000; this.choke.Q.value = 0.7;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -15; this.comp.ratio.value = 3; this.comp.knee.value = 6; this.comp.attack.value = 0.008; this.comp.release.value = 0.16;
      this.master = c.createGain(); this.master.gain.value = 0.85;
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -2; this.limiter.ratio.value = 20; this.limiter.knee.value = 0; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08;
      this.bus.connect(this.choke); this.choke.connect(this.comp); this.comp.connect(this.master); this.master.connect(this.limiter); this.limiter.connect(c.destination);
      // reverb
      this.revIn = c.createGain();
      const conv = c.createConvolver(); conv.buffer = this.impulse(2.2);
      const revHp = c.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 250;
      const revRet = c.createGain(); revRet.gain.value = 0.3;
      this.revIn.connect(revHp); revHp.connect(conv); conv.connect(revRet); revRet.connect(this.choke);
      // dub delay with darkening feedback
      this.dlyIn = c.createGain();
      this.delay = c.createDelay(2); this.delay.delayTime.value = 0.3;
      const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
      const dhp = c.createBiquadFilter(); dhp.type = 'highpass'; dhp.frequency.value = 280;
      const fb = c.createGain(); fb.gain.value = 0.42;
      const dret = c.createGain(); dret.gain.value = 0.5;
      this.dlyIn.connect(this.delay); this.delay.connect(dlp); dlp.connect(dhp); dhp.connect(fb); fb.connect(this.delay); dhp.connect(dret); dret.connect(this.choke);
      // one-shot FX (KO hits) bypass the choke/fade
      this.fxBus = c.createGain(); this.fxBus.gain.value = 0.9; this.fxBus.connect(this.limiter);
    }
    impulse(secs) {
      const c = this.ctx, len = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch); let lp = 0;
        for (let i = 0; i < len; i++) { const n = Math.random() * 2 - 1; lp += 0.35 * (n - lp); d[i] = lp * Math.pow(1 - i / len, 2.6); }
      }
      return b;
    }
    setTempo(bpm, note) { this.delay.delayTime.setValueAtTime((note || 0.75) * 60 / bpm, this.ctx.currentTime); }
    decode(ab) { return new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)); }
    load(path) {
      if (this.buf[path]) return Promise.resolve(this.buf[path]);
      if (!this.loads[path]) {
        this.loads[path] = fetch(this.base + path)
          .then((r) => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.arrayBuffer(); })
          .then((ab) => this.decode(ab))
          .then((b) => { this.buf[path] = b; return b; })
          .catch((e) => { delete this.loads[path]; throw e; });
      }
      return this.loads[path];
    }
    async loadSong(song) {
      const need = new Set(), multis = new Set();
      Object.values(song.inst).forEach((i) => { if (i.s) need.add(i.s); if (i.b) need.add(i.b); if (i.m) multis.add(i.m); });
      if (multis.size) {
        if (!this.multi) this.multi = await (await fetch(this.base + 'pads/pads.json')).json();
        multis.forEach((m) => (this.multi[m] || []).forEach((z) => need.add('pads/' + z.file)));
      }
      if (song.audio) need.add(song.audio);
      await Promise.all([...need].map((p) => this.load(p)));
    }
    out(node, o, t) {
      const g = this.ctx.createGain(); g.gain.value = o.g == null ? 1 : o.g;
      node.connect(g); g.connect(o.fx ? this.fxBus : this.bus);
      if (o.rev) { const s = this.ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(this.revIn); }
      if (o.dly) { const s = this.ctx.createGain(); s.gain.value = o.dly; g.connect(s); s.connect(this.dlyIn); }
      return g;
    }
    playBuf(buf, t, o) {
      const c = this.ctx, src = c.createBufferSource();
      src.buffer = buf;
      const rate = o.rate || 1;
      src.playbackRate.setValueAtTime(rate, t);
      const env = c.createGain();
      const peak = o.vel == null ? 1 : o.vel;
      env.gain.setValueAtTime(peak, t);
      const natural = buf.duration / rate;
      let end = natural;
      if (o.dur && o.dur < natural) {
        const rel = o.rel || 0.06;
        env.gain.setValueAtTime(peak, t + o.dur);
        env.gain.exponentialRampToValueAtTime(TINY, t + o.dur + rel);
        end = Math.min(natural, o.dur + rel);
      }
      src.connect(env); this.out(env, o, t);
      src.start(t); src.stop(t + end + 0.02);
      return { src, env };
    }
    // play one pad hit: inst spec + note(s) at audio time t
    hit(inst, note, t, vel, dur) {
      const c = this.ctx;
      t = Math.max(t, c.currentTime);
      if (inst.s) {
        const b = this.buf[inst.s]; if (!b) return;
        return this.playBuf(b, t, { g: inst.g, rev: inst.rev, dly: inst.dly, vel, dur: inst.dur, rel: 0.3, fx: inst.fx });
      }
      if (inst.m) {
        const zones = (this.multi && this.multi[inst.m]) || [];
        const notes = Array.isArray(note) ? note : [note];
        const d = inst.dur || Math.max(0.25, dur || 0.5);
        notes.forEach((m, i) => {
          let best = zones[0]; if (!best) return;
          zones.forEach((z) => { if (Math.abs(z.root - m) < Math.abs(best.root - m)) best = z; });
          const b = this.buf['pads/' + best.file]; if (!b) return;
          // tiny strum keeps chords from sounding like one blob
          this.playBuf(b, t + i * 0.006, { g: inst.g, rev: inst.rev, dly: inst.dly, vel: vel * (i === 0 ? 1 : 0.85), dur: d, rel: inst.rel || 0.25, rate: Math.pow(2, (m - best.root) / 12) });
        });
        return;
      }
      if (inst.b) { // mono pitched 808
        const b = this.buf[inst.b]; if (!b) return;
        this.cut('808', t);
        const v = this.playBuf(b, t, { g: inst.g, vel, dur: Math.max(0.12, dur || 0.4), rel: 0.08, rate: Math.pow(2, (note - inst.root) / 12) });
        this.mono['808'] = v;
        return;
      }
      if (inst.syn === 'reese') return this.reese(inst, note, t, vel, dur || 0.3);
      if (inst.syn === 'power') return this.power(inst, note, t, vel, dur || 0.2);
      if (inst.syn === 'siren') return this.siren(inst, note, t, vel);
    }
    cut(key, t) {
      const v = this.mono[key]; if (!v) return;
      try { v.env.gain.cancelScheduledValues(t); v.env.gain.setTargetAtTime(0, t, 0.012); v.src.stop(t + 0.08); } catch (e) { /* already stopped */ }
      this.mono[key] = null;
    }
    reese(inst, midi, t, vel, dur) {
      const c = this.ctx, f = midiHz(midi);
      this.cut('reese', t);
      const a = c.createOscillator(); a.type = 'sawtooth'; a.frequency.setValueAtTime(f, t); a.detune.setValueAtTime(-11, t);
      const b = c.createOscillator(); b.type = 'sawtooth'; b.frequency.setValueAtTime(f, t); b.detune.setValueAtTime(13, t);
      const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(f, t);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(inst.cutoff || 400, t);
      const mix = c.createGain(); mix.gain.value = 0.32;
      a.connect(mix); b.connect(mix); mix.connect(lp);
      const ws = c.createWaveShaper(); ws.curve = satCurve(inst.drive || 2.2);
      lp.connect(ws);
      const subG = c.createGain(); subG.gain.value = 0.8; sub.connect(subG);
      const env = c.createGain();
      const peak = vel;
      env.gain.setValueAtTime(TINY, t); env.gain.linearRampToValueAtTime(peak, t + 0.006);
      env.gain.setValueAtTime(peak, t + dur); env.gain.exponentialRampToValueAtTime(TINY, t + dur + 0.09);
      ws.connect(env); subG.connect(env);
      const nodes = [a, b, sub];
      if (inst.wobble) {
        const lfo = c.createOscillator(); lfo.type = 'sine';
        lfo.frequency.setValueAtTime(inst.wobble / (60 / (this.bpm || 70)), t);
        const depth = c.createGain(); depth.gain.value = inst.depth || 700;
        lfo.connect(depth); depth.connect(lp.frequency); nodes.push(lfo);
      } else {
        lp.frequency.setValueAtTime((inst.cutoff || 900) * 3, t);
        lp.frequency.exponentialRampToValueAtTime(inst.cutoff || 900, t + 0.12);
      }
      this.out(env, inst, t);
      nodes.forEach((n) => { n.start(t); n.stop(t + dur + 0.12); });
      this.mono.reese = { src: a, env };
    }
    power(inst, notes, t, vel, dur) {
      const c = this.ctx;
      const ws = c.createWaveShaper(); ws.curve = satCurve(9); ws.oversample = '2x';
      const pre = c.createGain(); pre.gain.value = 0.35;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2900; lp.Q.value = 0.8;
      const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 450; pk.gain.value = -5; pk.Q.value = 1.2;
      const env = c.createGain();
      const len = Math.max(0.12, dur);
      env.gain.setValueAtTime(TINY, t); env.gain.linearRampToValueAtTime(vel, t + 0.004);
      env.gain.setValueAtTime(vel * 0.8, t + len); env.gain.exponentialRampToValueAtTime(TINY, t + len + 0.12);
      pre.connect(ws); ws.connect(lp); lp.connect(pk); pk.connect(env);
      (Array.isArray(notes) ? notes : [notes]).forEach((m) => {
        [-9, 8].forEach((dt) => {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(midiHz(m), t); o.detune.setValueAtTime(dt, t);
          o.connect(pre); o.start(t); o.stop(t + len + 0.15);
        });
      });
      this.out(env, inst, t);
    }
    siren(inst, midi, t, vel) {
      const c = this.ctx, f = midiHz(midi || 76);
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.25);
      const lfo = c.createOscillator(); lfo.frequency.value = 6.5;
      const lg = c.createGain(); lg.gain.value = f * 0.12; lfo.connect(lg); lg.connect(o.frequency);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const env = c.createGain();
      env.gain.setValueAtTime(TINY, t); env.gain.linearRampToValueAtTime(vel * 0.5, t + 0.03);
      env.gain.setValueAtTime(vel * 0.5, t + 0.55); env.gain.exponentialRampToValueAtTime(TINY, t + 0.9);
      o.connect(lp); lp.connect(env); this.out(env, inst, t);
      o.start(t); o.stop(t + 0.95); lfo.start(t); lfo.stop(t + 0.95);
    }
    startCrackle(t) {
      const c = this.ctx, len = c.sampleRate * 4, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * 0.012;
        if (Math.random() < 0.0004) { const a = (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1); for (let k = 0; k < 24 && i + k < len; k++) d[i + k] += a * Math.exp(-k / 4); }
      }
      const s = c.createBufferSource(); s.buffer = b; s.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0.35;
      s.connect(hp); hp.connect(g); g.connect(this.bus); s.start(t);
      this.crackle = s;
    }
    stopCrackle() { if (this.crackle) { try { this.crackle.stop(); } catch (e) { /* noop */ } this.crackle = null; } }
    missChoke() {
      const f = this.choke.frequency, t = this.ctx.currentTime;
      f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(650, t + 0.03); f.setTargetAtTime(20000, t + 0.08, 0.12);
    }
    reset() {
      const t = this.ctx.currentTime;
      this.bus.gain.cancelScheduledValues(t); this.bus.gain.setValueAtTime(1, t);
      this.choke.frequency.cancelScheduledValues(t); this.choke.frequency.setValueAtTime(20000, t);
      this.revIn.gain.setValueAtTime(1, t); this.dlyIn.gain.setValueAtTime(1, t);
    }
    tapeStop(at) {
      const t = Math.max(at, this.ctx.currentTime);
      this.bus.gain.cancelScheduledValues(t); this.bus.gain.setValueAtTime(this.bus.gain.value || 1, t); this.bus.gain.linearRampToValueAtTime(0, t + 0.9);
      this.choke.frequency.cancelScheduledValues(t); this.choke.frequency.setValueAtTime(12000, t); this.choke.frequency.exponentialRampToValueAtTime(180, t + 0.9);
      this.cut('808', t + 0.9); this.cut('reese', t + 0.9);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const CSS = `
.pb{--void:#03050C;--panel:#0A1124;--panel2:#0D1630;--line:#18264A;--line2:#24396B;--cyan:#00E5FF;--blue:#2F7BFF;--mag:#FF2BD6;--pink:#FF5FA2;--amber:#FFB020;--ok:#3CFFB4;--text:#DCE6FF;--mute:#7F8DB5;--dim:#4A5880;
 --h:'Chakra Petch',ui-sans-serif,system-ui,sans-serif;--m:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;--cut:16px;
 position:relative;max-width:680px;margin:0 auto;padding:1px;background:linear-gradient(150deg,var(--cyan),var(--line2) 35%,var(--line) 65%,var(--mag));
 clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%,0 var(--cut));color:var(--text);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.pb *{box-sizing:border-box}
.pb-in{position:relative;min-height:700px;background:radial-gradient(60% 40% at 50% 100%,rgba(47,123,255,.16),transparent),linear-gradient(180deg,var(--panel2),var(--panel) 30%,#050914);
 clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,0 100%,0 var(--cut))}
.pb-lbl,.pb-tugl,.pb-hud,.pb-foot,.pb-note,.pb-res{font-family:var(--m)}
.pb-stage{display:grid;grid-template-columns:1fr 1.6fr 1fr;gap:10px;align-items:center;padding:16px 16px 10px;border-bottom:1px solid var(--line)}
.pb-bot{display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;min-width:0}
.pb-bot .av{position:relative;width:76px;height:76px;padding:2px;background:var(--c);clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}
.pb-bot .av img{width:100%;height:100%;object-fit:cover;display:block;clip-path:inherit;background:var(--panel)}
.pb-bot .nm{font:700 12px/1.1 var(--h);letter-spacing:.06em;text-transform:uppercase;color:var(--text);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pb-bot .cl{font:500 9px/1 var(--m);letter-spacing:.16em;color:var(--c)}
.pb-you{--c:var(--cyan)}.pb-rival{--c:var(--mag)}
.pb-bot.atk .av{animation:pbAtk .28s ease-out}
.pb-rival.atk .av{animation:pbAtkR .28s ease-out}
.pb-bot.hurt .av{animation:pbHurt .32s}
.pb-bot.ko .av{filter:grayscale(1) brightness(.45);transform:rotate(-10deg)}
@keyframes pbAtk{40%{transform:translateX(14px) scale(1.08)}}
@keyframes pbAtkR{40%{transform:translateX(-14px) scale(1.08)}}
@keyframes pbHurt{20%{transform:translateX(-5px);filter:brightness(2.2) saturate(0)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}}
.pb-mid{min-width:0;text-align:center}
.pb-tug{position:relative;height:12px;background:linear-gradient(90deg,var(--pink),var(--mag));border:1px solid var(--line2);overflow:hidden}
.pb-tug>i{position:absolute;left:0;top:0;bottom:0;width:50%;background:linear-gradient(90deg,var(--blue),var(--cyan));box-shadow:0 0 12px var(--cyan);transition:width .14s ease-out}
.pb-tug::after{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--text);opacity:.8}
.pb-tugl{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.18em;color:var(--dim);margin-top:5px}
.pb-tugl span:first-child{color:var(--cyan)}.pb-tugl span:last-child{color:var(--mag)}
.pb-turn{margin-top:9px;font:700 16px/1 var(--h);letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.pb-turn.you{color:var(--cyan);text-shadow:0 0 16px rgba(0,229,255,.6)}
.pb-turn.rival{color:var(--mag);text-shadow:0 0 14px rgba(255,43,214,.45)}
.pb-turn.pop{animation:pbPop .35s}
@keyframes pbPop{40%{transform:scale(1.22)}}
.pb-dots{display:flex;gap:3px;justify-content:center;margin-top:8px;min-height:8px}
.pb-dots i{width:9px;height:6px;background:var(--line)}
.pb-dots i.bar{background:var(--line2)}
.pb-dots i.on{background:currentColor;box-shadow:0 0 8px currentColor}
.pb-mini{display:grid;grid-template-columns:repeat(4,9px);gap:2px;margin-top:2px}
.pb-mini i{width:9px;height:9px;background:var(--line);transition:background .08s}
.pb-mini i.f{background:var(--c);box-shadow:0 0 6px var(--c);transition:none}
.pb-mini i.x{background:var(--dim);transition:none}
.pb-hud{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:rgba(3,5,12,.55);border-bottom:1px solid var(--line);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
.pb-hud b{display:block;font:700 22px/1.05 var(--m);letter-spacing:.02em;color:var(--text);text-shadow:0 0 12px rgba(0,229,255,.45);margin-top:3px}
.pb-hud .cb b{color:var(--mag);text-shadow:0 0 12px rgba(255,43,214,.45)}
.pb-abil{display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:0}
.pb-meter{display:grid;grid-template-columns:repeat(20,1fr);gap:2px;width:140px}
.pb-meter i{height:8px;background:var(--line)}
.pb-meter i.on{background:linear-gradient(0deg,var(--mag),var(--cyan));box-shadow:0 0 6px rgba(0,229,255,.5)}
.pb-abtn{font:600 9.5px/1 var(--m);letter-spacing:.12em;padding:7px 10px;border:1px solid var(--line2);background:var(--panel);color:var(--dim);cursor:pointer;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.pb-abtn.ready{background:var(--cyan);color:var(--void);border-color:var(--cyan);animation:pbGlow .9s infinite alternate}
.pb-abtn.live{background:var(--mag);color:var(--void);border-color:var(--mag)}
@keyframes pbGlow{to{box-shadow:0 0 18px var(--cyan)}}
.pb-cue{position:relative;height:66px;margin:14px 14px 0;border:1px solid var(--line2);background:linear-gradient(90deg,rgba(0,229,255,.07),transparent 30%),#020409;overflow:hidden}
.pb-cue::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(36,57,107,.35) 1px,transparent 1px) 0 0/40px 100%}
.pb-cue.rival{background:linear-gradient(90deg,rgba(255,43,214,.08),transparent 30%),#020409}
.pb-hit{position:absolute;left:46px;top:0;bottom:0;width:3px;margin-left:-1px;background:var(--cyan);box-shadow:0 0 14px var(--cyan);z-index:1}
.pb-cue.rival .pb-hit{background:var(--mag);box-shadow:0 0 14px var(--mag)}
.pb-cuel{position:absolute;inset:0}
.pb-cue .c,.pb-demo .c{position:absolute;left:0;top:50%;display:flex;flex-direction:column;gap:2px;margin-left:-15px;will-change:transform;z-index:2}
.pb-cue .c b,.pb-demo .c b{min-width:30px;height:24px;padding:0 4px;display:grid;place-items:center;font:700 14px/1 var(--m);background:var(--cyan);color:var(--void);box-shadow:0 0 10px rgba(0,229,255,.55)}
.pb-cue .c.r b{background:transparent;color:var(--mag);border:2px solid var(--mag);box-shadow:none}
.pb-cue .c.r.miss b{opacity:.3}
.pb-cue .c.y.hit b{background:var(--ok);opacity:.35;box-shadow:none}
.pb-cue .c.y.miss b{background:var(--pink);opacity:.45;box-shadow:none}
.pb-cueh{position:absolute;right:8px;top:5px;font:500 9px/1 var(--m);letter-spacing:.16em;color:var(--mute);z-index:3}
.pb-cue.you .pb-cueh{color:var(--cyan)}.pb-cue.rival .pb-cueh{color:var(--mag)}
.pb-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;width:100%;max-width:540px}
.pb-steps li{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);background:rgba(10,17,36,.7);padding:12px 14px;font-size:13.5px;line-height:1.55;color:#A9B6DA}
.pb-steps li>i{flex:none;width:26px;height:30px;display:grid;place-items:center;font:700 12px/1 var(--m);font-style:normal;color:var(--void);background:var(--cyan);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.pb-steps b{color:var(--text)}
.pb-demo{position:relative;height:66px;margin:10px 0 8px;border:1px solid var(--line2);background:#020409}
.pb-demo .pb-hit{left:46px}
.pb-demo .c{transform:translateY(-50%)}
.pb-demo .c:first-of-type{left:46px}
.pb-keys{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}
.pb-keys b{min-width:30px;height:28px;display:grid;place-items:center;font:700 13px/1 var(--m);border:1px solid var(--line2);color:var(--mute)}
.pb-keys b.on{background:var(--cyan);color:var(--void);border-color:var(--cyan)}
.pb-keys small{flex-basis:100%;font:500 10.5px/1.4 var(--m);color:var(--dim);margin-top:4px}
.pb-gw{position:relative;padding:14px 14px 16px;display:flex;justify-content:center}
.pb-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:min(100%,440px)}
.pb-pad{position:relative;aspect-ratio:1/1;border:1px solid var(--line2);background:radial-gradient(circle at 50% 120%,color-mix(in srgb,var(--c) 22%,transparent),transparent 70%),#070C1B;
 display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;padding:7px;font:700 10px/1.15 var(--m);letter-spacing:.04em;color:var(--dim);touch-action:none;cursor:pointer;text-align:left;
 clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);transition:transform .06s}
.pb-pad .k{position:absolute;top:6px;right:8px;font:500 9px/1 var(--m);color:var(--dim)}
.pb-pad .lb{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pb-pad.act{border-color:color-mix(in srgb,var(--c) 55%,var(--line2));color:var(--text)}
.pb-pad.act .k{color:var(--c)}
.pb-pad.off{opacity:.22}
.pb-pad.down{transform:scale(.95)}
.pb-pad .fl{position:absolute;inset:0;background:var(--c);opacity:0;pointer-events:none;mix-blend-mode:screen}
.pb-pad .rg{position:absolute;inset:0;border:3px solid var(--c);box-shadow:0 0 14px var(--c),inset 0 0 10px color-mix(in srgb,var(--c) 40%,transparent);opacity:0;pointer-events:none;will-change:transform,opacity;
 clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
.pb-pad .gh{position:absolute;inset:0;background:radial-gradient(circle,color-mix(in srgb,var(--mag) 55%,transparent),transparent 75%);box-shadow:inset 0 0 0 2px var(--mag);opacity:0;pointer-events:none}
.pb-judge{position:absolute;left:50%;top:-4px;transform:translateX(-50%);font:700 20px/1 var(--h);letter-spacing:.12em;text-transform:uppercase;pointer-events:none;opacity:0;white-space:nowrap;text-shadow:0 0 16px currentColor,0 2px 8px #000}
.pb-judge.show{animation:pbJ .45s ease-out}
@keyframes pbJ{0%{opacity:1;transform:translate(-50%,6px) scale(1.2)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-6px)}}
.pb-banner{position:absolute;left:0;right:0;top:42%;text-align:center;font:700 26px/1.1 var(--h);letter-spacing:.08em;text-transform:uppercase;pointer-events:none;opacity:0;z-index:3;text-shadow:0 0 22px currentColor}
.pb-banner.show{animation:pbBan 1.3s ease-out}
@keyframes pbBan{0%{opacity:0;transform:scale(.7)}15%{opacity:1;transform:scale(1.08)}75%{opacity:1}100%{opacity:0;transform:scale(1)}}
.pb.shake{animation:pbShake .35s}
@keyframes pbShake{20%{transform:translate(-4px,2px)}40%{transform:translate(4px,-2px)}60%{transform:translate(-3px,1px)}80%{transform:translate(2px,-1px)}}
.pb-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 16px 14px;border-top:1px solid var(--line);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.pb-foot>span:last-child{display:flex;gap:6px;flex:none}
.pb-foot button{white-space:nowrap;font:600 10px/1 var(--m);letter-spacing:.12em;color:var(--mute);background:var(--panel);border:1px solid var(--line2);padding:8px 12px;cursor:pointer}
.pb-ov{position:absolute;inset:0;z-index:10;background:linear-gradient(180deg,rgba(3,5,12,.97),rgba(6,10,22,.96));overflow-y:auto;padding:22px 18px;display:flex;flex-direction:column;align-items:center;gap:13px}
.pb-ov.hide{display:none}
.pb-tag{display:inline-flex;align-items:center;gap:8px;font:500 10px/1.3 var(--m);letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);padding:6px 10px;border:1px solid rgba(0,229,255,.4);background:rgba(3,5,12,.7)}
.pb-h{font:700 30px/1 var(--h);letter-spacing:.04em;text-transform:uppercase;color:var(--text);text-align:center}
.pb-sub{font-size:13.5px;line-height:1.55;color:var(--mute);text-align:center;max-width:440px}
.pb-lbl{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);width:100%;max-width:540px;display:flex;align-items:center;gap:10px}
.pb-lbl::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent)}
.pb-pick{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;width:100%;max-width:540px}
.pb-card{display:flex;flex-direction:column;gap:5px;padding:0 0 8px;border:1px solid var(--line);background:var(--panel);cursor:pointer;color:var(--mute);min-width:0;text-align:left;overflow:hidden;transition:.2s}
.pb-card img{width:100%;aspect-ratio:1/.85;object-fit:cover;display:block;filter:saturate(.8) brightness(.7);transition:.25s}
.pb-card span{font:700 10px/1.1 var(--h);letter-spacing:.06em;text-transform:uppercase;padding:0 7px;color:var(--text)}
.pb-card small{font:500 8px/1 var(--m);letter-spacing:.06em;color:var(--dim);padding:0 7px}
.pb-card:hover,.pb-card.sel{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan),0 0 22px rgba(0,229,255,.22)}
.pb-card:hover img,.pb-card.sel img{filter:none}
.pb-row{display:flex;width:100%;max-width:540px}
.pb-chip{flex:1 1 0;min-width:0;padding:10px 4px;border:1px solid var(--line2);margin-left:-1px;background:transparent;color:var(--mute);font:600 10.5px/1.15 var(--m);letter-spacing:.08em;cursor:pointer;text-align:center}
.pb-chip small{display:block;font-weight:400;font-size:8.5px;color:var(--dim);margin-top:3px;letter-spacing:.06em}
.pb-chip.sel{background:var(--cyan);border-color:var(--cyan);color:var(--void)}
.pb-chip.sel small{color:#0b2a35}
.pb-songs{list-style:none;margin:0;padding:0;width:100%;max-width:540px}
.pb-songs li{display:flex;gap:12px;align-items:center;padding:9px 4px;border-bottom:1px solid var(--line);font:500 12px/1.2 var(--m);color:var(--mute);cursor:pointer}
.pb-songs li span{color:var(--dim)}
.pb-songs li em{font-style:normal;margin-left:auto;font-size:10px;color:var(--dim);letter-spacing:.08em}
.pb-songs li.sel{color:var(--cyan)}
.pb-songs li.sel em{color:var(--cyan)}
.pb-go{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:16px 34px;border:0;background:linear-gradient(90deg,var(--cyan),var(--blue));color:#020611;font:700 15px/1 var(--h);letter-spacing:.14em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 30px rgba(0,229,255,.35);
 clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.pb-go:hover{filter:brightness(1.15)}
.pb-go:active{transform:scale(.97)}
.pb-go[disabled]{opacity:.6;cursor:wait}
.pb-btn2{display:inline-flex;align-items:center;padding:16px 22px;border:0;background:rgba(0,229,255,.06);box-shadow:inset 0 0 0 1px rgba(0,229,255,.45);color:var(--cyan);font:700 13px/1 var(--h);letter-spacing:.12em;text-transform:uppercase;cursor:pointer;
 clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.pb-note{font-size:10.5px;line-height:1.55;letter-spacing:.04em;color:var(--dim);text-align:center;max-width:480px}
.pb-note b{color:var(--cyan);font-weight:600}
.pb-res{display:grid;grid-template-columns:1fr auto;gap:0;border:1px solid var(--line2);background:rgba(10,17,36,.8);width:100%;max-width:360px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}
.pb-res span,.pb-res b{padding:9px 14px;border-bottom:1px dashed var(--line2)}
.pb-res b{color:var(--text);text-align:right;font-weight:600}
.pb-grade{font:700 72px/1 var(--h);text-shadow:0 0 30px currentColor}
.pb-btns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
@media (max-width:560px){
 .pb{--cut:12px}
 .pb-in{min-height:580px}
 .pb-stage{padding:12px 10px 8px;gap:6px}
 .pb-bot .av{width:58px;height:58px}
 .pb-bot .nm{font-size:10.5px}
 .pb-turn{font-size:13px}
 .pb-grid{gap:7px}
 .pb-pad{font-size:9px;padding:5px}
 .pb-pad .k{top:4px;right:5px;font-size:8px}
 .pb-meter{width:96px}
 .pb-hud{padding:8px 12px}
 .pb-hud b{font-size:18px}
 .pb-foot{font-size:9px;letter-spacing:.08em;padding:10px 12px 12px}
 .pb-foot button{padding:7px 8px;font-size:9px}
 .pb-pick{grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
 .pb-card span{font-size:8.5px;padding:0 4px}
 .pb-card small{display:none}
 .pb-h{font-size:24px}
}
@media (prefers-reduced-motion:reduce){.pb.shake,.pb-bot.atk .av,.pb-rival.atk .av,.pb-bot.hurt .av,.pb-abtn.ready{animation:none}}
`;

  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  class PadBattle {
    constructor(root, opts) {
      this.root = root;
      this.opts = Object.assign({ kitBase: 'kits/', clans: {} }, opts || {});
      this.clans = this.opts.clans;
      const saved = store.get('pb-setup', {});
      this.setup = {
        clan: this.clans[saved.clan] ? saved.clan : 'bboy',
        song: SONGS.some((s) => s.id === saved.song) ? saved.song : null,
        diff: DIFFS[saved.diff] ? saved.diff : 'easy',
        bt: !!saved.bt,
      };
      this.running = false;
      this.render();
      this.bindKeys();
      this.chips = [];
      this.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      if (store.get('pb-howto', false)) this.showSetup(); else this.showHowTo();
    }

    clanInfo(key) {
      const c = this.clans[key] || {};
      const img = (c.editions && c.editions[0] && c.editions[0].img) || '';
      const color = '#00E5FF';
      return { key, title: c.title || key, img, color, atk: c.atk || 92, def: c.def || 92, spd: c.spd || 92, short: CLAN_SHORT[key] || key.toUpperCase() };
    }

    render() {
      if (!document.getElementById('pb-css')) {
        const s = document.createElement('style'); s.id = 'pb-css'; s.textContent = CSS; document.head.appendChild(s);
      }
      const pads = ROLES.map((r, i) => `<div class="pb-pad" data-pad="${i}" style="--c:${ROW_COLORS[Math.floor(i / 4)]}"><span class="k">${KEYS[i].toUpperCase()}</span><span class="lb"></span><i class="fl"></i><i class="gh"></i><i class="rg"></i><i class="rg"></i></div>`).join('');
      const mini = ROLES.map((r, i) => `<i style="--c:${ROW_COLORS[Math.floor(i / 4)]}"></i>`).join('');
      this.root.innerHTML = '';
      this.ui = el(`<div class="pb"><div class="pb-in">
        <div class="pb-stage">
          <div class="pb-bot pb-you"><div class="av"><img alt="Your BeatBot"></div><div class="nm"></div><div class="cl"></div></div>
          <div class="pb-mid">
            <div class="pb-tug"><i></i></div>
            <div class="pb-tugl"><span>YOU</span><span>RIVAL</span></div>
            <div class="pb-turn">GET READY</div>
            <div class="pb-dots"></div>
          </div>
          <div class="pb-bot pb-rival"><div class="av"><img alt="Rival BeatBot"></div><div class="nm"></div><div class="pb-mini">${mini}</div></div>
        </div>
        <div class="pb-hud">
          <div>SCORE<b class="sc">0</b></div>
          <div class="cb">COMBO<b class="co">0</b></div>
          <div class="pb-abil"><button class="pb-abtn" type="button">ABILITY [SPACE]</button><div class="pb-meter">${'<i></i>'.repeat(20)}</div></div>
        </div>
        <div class="pb-cue"><i class="pb-hit"></i><div class="pb-cuel"></div><span class="pb-cueh">GET READY</span></div>
        <div class="pb-gw"><div class="pb-judge"></div><div class="pb-grid">${pads}</div><div class="pb-banner"></div></div>
        <div class="pb-foot"><span class="tr"></span><span><button type="button" class="hw">? HOW TO PLAY</button> <button type="button" class="qt">QUIT</button></span></div>
        <div class="pb-ov"></div>
      </div></div>`);
      this.root.appendChild(this.ui);
      const q = (s) => this.ui.querySelector(s);
      this.$ = {
        you: q('.pb-you'), rival: q('.pb-rival'), tug: q('.pb-tug>i'), turn: q('.pb-turn'), dots: q('.pb-dots'),
        mini: [...q('.pb-mini').children], score: q('.sc'), combo: q('.co'), abtn: q('.pb-abtn'), meter: [...q('.pb-meter').children],
        judge: q('.pb-judge'), cue: q('.pb-cue'), cuel: q('.pb-cuel'), cueh: q('.pb-cueh'), banner: q('.pb-banner'), track: q('.tr'), ov: q('.pb-ov'),
        pads: [...this.ui.querySelectorAll('.pb-pad')],
      };
      this.$.padParts = this.$.pads.map((p) => ({ lb: p.querySelector('.lb'), fl: p.querySelector('.fl'), gh: p.querySelector('.gh'), rg: [...p.querySelectorAll('.rg')] }));
      this.$.pads.forEach((p, i) => {
        p.addEventListener('pointerdown', (e) => { e.preventDefault(); this.press(i, e); p.classList.add('down'); });
        const up = () => p.classList.remove('down');
        p.addEventListener('pointerup', up); p.addEventListener('pointerleave', up); p.addEventListener('pointercancel', up);
      });
      this.$.abtn.addEventListener('click', () => this.useAbility());
      q('.qt').addEventListener('click', () => this.end('quit'));
      q('.hw').addEventListener('click', () => { if (this.running) this.end('quit'); this.showHowTo(); });
      window.addEventListener('resize', () => { this.cueW = 0; });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.running) this.end('quit'); });
    }

    bindKeys() {
      document.addEventListener('keydown', (e) => {
        if (!this.running) return;
        const k = e.key.toLowerCase();
        const i = KEYS.indexOf(k);
        if (i >= 0 || k === ' ' || k === 'escape') { e.preventDefault(); e.stopPropagation(); }
        if (e.repeat) return;
        if (i >= 0) { this.press(i, e); const p = this.$.pads[i]; p.classList.add('down'); setTimeout(() => p.classList.remove('down'), 90); }
        else if (k === ' ') this.useAbility();
        else if (k === 'escape') this.end('quit');
      }, true);
    }

    // ---------- setup screen ----------
    showSetup() {
      const s = this.setup;
      const clans = Object.keys(CLAN_SHORT).filter((k) => this.clans[k]);
      const holder = this.opts.getHolderBot && this.opts.getHolderBot();
      const cards = clans.map((k) => {
        const c = this.clanInfo(k);
        return `<button type="button" class="pb-card${s.clan === k ? ' sel' : ''}" data-clan="${k}" ><img src="${esc(c.img)}" alt="${esc(c.title)}" loading="lazy"><span>${esc(c.short)}</span><small>ATK ${c.atk} DEF ${c.def}</small></button>`;
      }).join('');
      const cur = s.song || this.defaultSong();
      const songOpts = SONGS.map((sg, i) => `<li data-song="${sg.id}" class="${cur === sg.id ? 'sel' : ''}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(sg.title)}<em>${sg.bpmLabel || sg.bpm} BPM · ${esc(CLAN_SHORT[sg.clan])}</em></li>`).join('');
      const diffs = Object.keys(DIFFS).map((d) => `<button type="button" class="pb-chip${s.diff === d ? ' sel' : ''}" data-diff="${d}">${DIFFS[d].label}<small>${DIFFS[d].pads} pads</small></button>`).join('');
      const ab = ABILITY[s.clan];
      this.$.ov.innerHTML = `
        <span class="pb-tag">MODULE 04 // BEAT BATTLE</span>
        <div class="pb-h">Beat Battle</div>
        <div class="pb-sub">Your rival plays a pattern, then you play it back. The strip above the pads shows exactly which keys to hit. New here? Start on Easy.</div>
        <button type="button" class="pb-btn2 pb-how">? How to play</button>
        <div class="pb-lbl">Choose your bot</div>
        <div class="pb-pick">${cards}</div>
        <div class="pb-note pb-abdesc">Clan ability: <b>${esc(ab.name)}</b> (${esc(ab.desc)})</div>
        <div class="pb-lbl">Track select</div>
        <ul class="pb-songs">${songOpts}</ul>
        <div class="pb-lbl">Difficulty</div>
        <div class="pb-row">${diffs}</div>
        <div class="pb-row"><button type="button" class="pb-chip pb-bt${s.bt ? ' sel' : ''}">${s.bt ? 'BLUETOOTH AUDIO ON' : 'WIRED / SPEAKER AUDIO'}<small>tap if you use wireless headphones</small></button></div>
        <button type="button" class="pb-go">▶ Start Battle</button>
        <div class="pb-note">Keys: 1 2 3 4 / Q W E R / A S D F / Z X C V &nbsp;·&nbsp; Space = ability &nbsp;·&nbsp; Tap pads on mobile</div>
        <div class="pb-note">${holder ? `Holder bot detected: ${esc(holder.name)}` : 'Genesis holders will load their own BeatBot here after mint (cosmetic: everyone battles on the same clan stats).'}</div>`;
      const ov = this.$.ov;
      ov.classList.remove('hide');
      ov.querySelectorAll('.pb-card').forEach((b) => b.addEventListener('click', () => {
        const prevDefault = this.defaultSong();
        s.clan = b.dataset.clan;
        if (!s.song || s.song === prevDefault) s.song = null; // track follows the bot unless picked
        this.showSetup();
      }));
      ov.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { s.diff = b.dataset.diff; this.showSetup(); }));
      ov.querySelectorAll('[data-song]').forEach((li) => li.addEventListener('click', () => { s.song = li.dataset.song; this.showSetup(); }));
      ov.querySelector('.pb-bt').addEventListener('click', () => { s.bt = !s.bt; this.showSetup(); });
      ov.querySelector('.pb-go').addEventListener('click', (e) => this.start(e.currentTarget));
      ov.querySelector('.pb-how').addEventListener('click', () => this.showHowTo());
      this.paintIdle();
    }
    showHowTo() {
      const keyRow = (ks, cls) => ks.map((k) => `<b class="${cls}">${k}</b>`).join('');
      this.$.ov.innerHTML = `
        <span class="pb-tag">HOW TO PLAY</span>
        <div class="pb-h">Beat Battle</div>
        <ol class="pb-steps">
          <li><i>1</i><div><b>Rival's turn</b> (pink). Your rival plays a short pattern. Listen, and watch the pink letters slide across the strip above the pads.</div></li>
          <li><i>2</i><div><b>Your turn</b> (cyan). The same pattern comes back as cyan letters. Hit each key the moment its letter reaches the line on the left.
            <div class="pb-demo"><i class="pb-hit"></i><span class="c"><b>A</b></span><span class="c" style="left:38%"><b>S</b></span><span class="c" style="left:56%"><b>A</b><b>S</b></span><span class="c" style="left:78%"><b>A</b></span></div>
            Two letters stacked = hit both at once.</div></li>
          <li><i>3</i><div><b>Keys or taps.</b> On a keyboard use the letters shown. On a phone, tap the glowing pad; its name is on the strip. A ring also closes on the pad right when to hit it.
            <div class="pb-keys">${keyRow(['A', 'S'], 'on')}${keyRow(['D', 'F'], '')}<small>Easy uses A + S. Standard adds D + F. Turbo adds Z X C V. Hyper uses all 16.</small></div></div></li>
          <li><i>4</i><div><b>Win the bar.</b> Your hits push the bar toward the rival; misses push it back. Fill it for a K.O., or lead when the track ends. Perfect streaks charge your clan ability: press <b>Space</b> or tap ABILITY.</div></li>
        </ol>
        <button type="button" class="pb-go pb-got">Got it, let's play</button>`;
      this.$.ov.classList.remove('hide');
      this.$.ov.scrollTop = 0;
      this.$.ov.querySelector('.pb-got').addEventListener('click', () => { store.set('pb-howto', true); this.showSetup(); });
      this.paintIdle();
    }

    defaultSong() { const m = SONGS.find((x) => x.clan === this.setup.clan); return (m || SONGS[0]).id; }
    selectBot(clan) { if (this.clans[clan] && !this.running) { this.setup.clan = clan; this.setup.song = null; this.showSetup(); } }

    paintIdle() {
      const song = SONGS.find((x) => x.id === (this.setup.song || this.defaultSong())) || SONGS[0];
      this.applySongLabels(song);
      this.paintBots(this.clanInfo(this.setup.clan), null);
      this.$.pads.forEach((p, i) => { p.classList.toggle('act', padOn(i, DIFFS[this.setup.diff])); p.classList.remove('off'); });
    }
    applySongLabels(song) {
      ROLES.forEach((r, i) => { this.$.padParts[i].lb.textContent = (song.pads[r] && song.pads[r].label) || ''; });
      this.$.track.textContent = `${song.title} · ${song.bpmLabel || song.bpm} BPM`;
    }
    paintBots(me, rv) {
      const y = this.$.you, r = this.$.rival;
      y.querySelector('img').src = me.img;
      y.querySelector('.nm').textContent = me.name || `${me.short}-01`; y.querySelector('.cl').textContent = me.short;
      if (rv) {
        r.querySelector('img').src = rv.img; r.querySelector('.nm').textContent = rv.name;
      } else { r.querySelector('img').src = RIVAL_UNKNOWN; r.querySelector('.nm').textContent = '???'; }
      y.classList.remove('ko'); r.classList.remove('ko');
    }

    // ---------- game ----------
    async start(btn) {
      const s = this.setup;
      store.set('pb-setup', s);
      const song = SONGS.find((x) => x.id === (s.song || this.defaultSong())) || SONGS[0];
      let ctx;
      try { ctx = this.opts.getCtx ? this.opts.getCtx() : new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
      if (!ctx) { this.toast('Audio is not available in this browser'); return; }
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* resumes on next gesture */ } }
      if (!this.audio || this.audio.ctx !== ctx) this.audio = new PBAudio(ctx, this.opts.kitBase);
      if (btn) { btn.disabled = true; btn.textContent = 'Loading sounds…'; }
      try { await this.audio.loadSong(song); } catch (e) {
        console.warn('pad battle load failed', e);
        if (btn) { btn.disabled = false; btn.textContent = '▶ Start Battle'; }
        this.toast('Could not load the sounds. Check your connection and try again.');
        return;
      }
      if (this.opts.onStart) this.opts.onStart();
      this.begin(song, s.diff);
    }

    begin(song, diffKey) {
      const A = this.audio, ctx = A.ctx;
      A.reset(); A.bpm = song.bpm; A.setTempo(song.bpm, song.delayNote);
      this.song = song; this.chart = compile(song, diffKey);
      const me = this.clanInfo(this.setup.clan);
      const others = Object.keys(CLAN_SHORT).filter((k) => k !== me.key && this.clans[k]);
      const rk = others[Math.floor(Math.random() * others.length)] || 'dub';
      const rv = this.clanInfo(rk);
      rv.name = `${rv.short} MK-${['II', 'III', 'IV', 'V', 'IX', 'X'][Math.floor(Math.random() * 6)]}`;
      const holder = this.opts.getHolderBot && this.opts.getHolderBot();
      if (holder && holder.clan === me.key) { me.name = holder.name; if (holder.img) me.img = holder.img; }
      this.me = me; this.rv = rv;
      this.paintBots(me, rv);
      this.applySongLabels(song);
      const D = this.chart.diff;
      this.$.pads.forEach((p, i) => { const on = padOn(i, D); p.classList.toggle('act', on); p.classList.toggle('off', !on); });

      // per-note values are normalised so a phrase moves the bar the same amount on every difficulty
      this.norm = 12 / Math.max(4, this.chart.notesPerPhrase);
      this.lat = (ctx.outputLatency || ctx.baseLatency || 0) + (this.setup.bt ? 0.18 : 0);
      this.startAt = ctx.currentTime + 0.25;
      this.tug = 50; this.score = 0; this.combo = 0; this.maxCombo = 0; this.meter = 0; this.abilityUntil = -1; this.abilityKind = null;
      this.counts = { perfect: 0, great: 0, good: 0, miss: 0, stray: 0 };
      this.notes = this.chart.player.map((n) => Object.assign({}, n, { j: null }));
      this.rivalQ = this.chart.rival.map((n) => Object.assign({}, n, { hit: null }));
      this.cueW = 0; this.chips.forEach((c) => { c.style.display = 'none'; c.dataset.k = ''; });
      this.bi = 0; this.ri = 0; this.ni = 0; this.fx = []; this.phaseIdx = -1; this.lastResult = null;
      if (song.audio) {
        const b = A.buf[song.audio];
        if (b) { const src = ctx.createBufferSource(); src.buffer = b; const g = ctx.createGain(); g.gain.value = song.audioGain || 0.9; src.connect(g); g.connect(A.bus); src.start(this.startAt - (song.audioOffset || 0) < ctx.currentTime ? ctx.currentTime : this.startAt - (song.audioOffset || 0)); this.track = src; }
      }
      if (song.crackle) A.startCrackle(this.startAt);
      this.$.ov.classList.add('hide');
      this.setRunning(true);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
      const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }

    setRunning(v) { this.running = v; if (this.opts.onRunningChange) this.opts.onRunningChange(v); }
    abilityOn(now) { return now < this.abilityUntil; }
    inst(pad) { const p = this.song.pads[ROLES[pad]]; return p ? { spec: this.song.inst[p.inst], note: p.note } : null; }
    sound(pad, t, vel, dur) { const x = this.inst(pad); if (x && x.spec) this.audio.hit(x.spec, x.note, t, vel, dur); }

    // audio scheduler: backing parts + the rival's call notes
    tick() {
      if (!this.running) return;
      const ctx = this.audio.ctx, horizon = ctx.currentTime + 0.14, S = this.startAt;
      if (!this.song.audio) {
        const B = this.chart.backing;
        while (this.bi < B.length && S + B[this.bi].t < horizon) { const e = B[this.bi++]; this.sound(e.pad, S + e.t, e.vel * 0.92, e.dur); }
      }
      const R = this.rivalQ;
      while (this.ri < R.length && S + R[this.ri].t < horizon) {
        const n = R[this.ri++];
        let acc = this.chart.diff.rival;
        if (this.abilityKind === 'bboy' && S + n.t < this.abilityUntil) acc -= 0.15;
        const hit = Math.random() < acc;
        n.hit = hit;
        const jit = (Math.random() + Math.random() - 1) * 0.022;
        const at = S + n.t + (hit ? jit : 0);
        if (hit) this.sound(n.pad, at, n.vel, n.dur);
        this.fx.push({ at: at + this.lat, kind: hit ? 'rhit' : 'rmiss', pad: n.pad });
      }
    }

    frame() {
      const ctx = this.audio.ctx, now = ctx.currentTime, S = this.startAt, lat = this.lat;
      const songT = now - S - lat; // what the player is hearing now, in song time
      // phrase / turn display
      const TL = this.chart.timeline;
      let pi = this.phaseIdx < 0 ? 0 : this.phaseIdx;
      while (pi < TL.length - 1 && songT >= TL[pi + 1].t0) pi++;
      if (pi !== this.phaseIdx) this.enterPhase(pi);
      const ph = TL[pi];
      const beat = Math.floor((songT - ph.t0) / this.chart.spb);
      if (beat !== this.lastBeat) { this.lastBeat = beat; this.paintDots(ph, beat); }

      // queued visual/damage events from the rival
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        if (now < f.at) continue;
        this.fx.splice(i, 1);
        if (f.kind === 'rhit') {
          this.flashMini(f.pad, 'f'); this.ghost(f.pad);
          this.push(-1.0 * this.norm * (this.rv.atk / this.me.def) * (this.abilityKind === 'industrial' && now < this.abilityUntil ? 0.5 : 1));
          this.anim(this.$.rival, 'atk'); this.anim(this.$.you, 'hurt');
        } else {
          this.flashMini(f.pad, 'x'); this.ghost(f.pad);
          this.push(0.4 * this.norm);
        }
      }

      // approach rings + misses
      const ap = this.chart.diff.approach;
      const used = new Array(16).fill(0);
      const N = this.notes;
      while (this.ni < N.length && N[this.ni].j) this.ni++;
      for (let i = this.ni; i < N.length; i++) {
        const n = N[i];
        const dt = n.t - songT;
        if (dt > ap) break;
        if (n.j) continue;
        if (dt < -WIN.good * this.winMult()) { this.judge(n, 'miss'); continue; }
        const r = this.$.padParts[n.pad].rg[used[n.pad]];
        if (!r) continue;
        used[n.pad]++;
        const k = Math.max(0, dt / ap);
        r.style.transform = `scale(${(1 + 0.95 * k).toFixed(3)})`;
        r.style.opacity = dt < 0 ? Math.max(0, 1 + dt * 8).toFixed(2) : (0.35 + 0.65 * (1 - k)).toFixed(2);
      }
      this.$.padParts.forEach((p, i) => { for (let k = used[i]; k < 2; k++) if (p.rg[k].style.opacity !== '0') p.rg[k].style.opacity = '0'; });

      this.paintCue(songT);
      this.$.tug.style.width = `${this.tug.toFixed(1)}%`;
      if (this.tug <= 0) return this.end('ko-lose');
      if (this.tug >= 100) return this.end('ko-win');
      if (songT > this.chart.total + 0.3) return this.end('done');
      if (this.abilityUntil > 0 && now >= this.abilityUntil) { this.abilityUntil = -1; this.abilityKind = null; this.paintAbility(); }
    }

    // the cue strip: upcoming notes as key letters sliding to a hit line (rival = pink, you = cyan)
    paintCue(songT) {
      const lane = this.$.cuel;
      const W = this.cueW || (this.cueW = lane.offsetWidth || 400);
      const hitX = 46, ahead = Math.max(2.6, this.chart.diff.approach * 2), behind = 0.35;
      const groups = [];
      const add = (list, who) => {
        let g = null;
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.t < songT - behind) continue;
          if (n.t > songT + ahead) break;
          if (g && Math.abs(g.t - n.t) < 0.002) { g.notes.push(n); continue; }
          g = { t: n.t, who, notes: [n] }; groups.push(g);
        }
      };
      add(this.rivalQ, 'r'); add(this.notes, 'y');
      while (this.chips.length < groups.length) { const c = document.createElement('span'); c.className = 'c'; lane.appendChild(c); this.chips.push(c); }
      this.chips.forEach((c, i) => {
        const g = groups[i];
        if (!g) { if (c.style.display !== 'none') c.style.display = 'none'; return; }
        const label = (pad) => (this.touch ? ((this.song.pads[ROLES[pad]] || {}).label || '').split(' ')[0].slice(0, 5) : KEYS[pad].toUpperCase());
        const j = g.who === 'y' ? (g.notes.every((n) => n.j) ? (g.notes.some((n) => n.j === 'miss') ? 'miss' : 'hit') : '') : (g.t <= songT && g.notes[0].hit === false ? 'miss' : '');
        const key = g.who + '|' + g.notes.map((n) => n.pad).join(',') + '|' + j;
        if (c.dataset.k !== key) { c.dataset.k = key; c.innerHTML = g.notes.map((n) => `<b>${label(n.pad)}</b>`).join(''); c.className = `c ${g.who}${j ? ' ' + j : ''}`; }
        const x = hitX + ((g.t - songT) / ahead) * (W - hitX - 10);
        c.style.display = '';
        c.style.transform = `translate(${x.toFixed(1)}px,-50%)`;
      });
    }

    enterPhase(pi) {
      this.phaseIdx = pi;
      const ph = this.chart.timeline[pi], t = this.$.turn;
      const txt = { intro: 'GET READY', call: "RIVAL'S TURN", resp: 'YOUR TURN!', outro: 'FINISH' }[ph.kind];
      t.textContent = txt;
      this.$.cueh.textContent = { intro: 'GET READY', call: 'RIVAL PLAYS · WATCH THE PATTERN', resp: 'YOUR TURN · HIT EACH KEY ON THE LINE', outro: 'FINISH' }[ph.kind];
      this.$.cue.className = 'pb-cue ' + (ph.kind === 'resp' ? 'you' : ph.kind === 'call' ? 'rival' : '');
      if (ph.kind === 'resp' && ph.ex === 0) this.banner('YOUR TURN!', '#00E5FF');
      t.className = 'pb-turn pop ' + (ph.kind === 'resp' ? 'you' : ph.kind === 'call' ? 'rival' : '');
      this.$.dots.style.color = ph.kind === 'resp' ? '#00E5FF' : ph.kind === 'call' ? '#FF2BD6' : '#7F8DB5';
      this.lastBeat = null;
    }
    paintDots(ph, beat) {
      const d = this.$.dots;
      if (d.childElementCount !== ph.beats) d.innerHTML = Array.from({ length: ph.beats }, (_, i) => `<i${i % 4 === 0 ? ' class="bar"' : ''}></i>`).join('');
      [...d.children].forEach((c, i) => c.classList.toggle('on', i === beat));
    }
    winMult() { return (this.chart.diff.win || 1) * (this.me.spd / 92) * (this.abilityKind === 'alchemist' && this.audio.ctx.currentTime < this.abilityUntil ? 1.12 : 1); }

    press(pad, e) {
      if (!this.running) return;
      const ctx = this.audio.ctx;
      let now = ctx.currentTime;
      if (e && e.timeStamp && typeof performance !== 'undefined') { // when the finger landed, not when JS ran
        const ago = (performance.now() - e.timeStamp) / 1000;
        if (ago > 0 && ago < 0.1) now -= ago;
      }
      const songT = now - this.startAt - this.lat;
      const wm = this.winMult();
      let best = null, bd = 9;
      for (let i = this.ni; i < this.notes.length; i++) {
        const n = this.notes[i];
        if (n.t - songT > WIN.good * wm) break;
        if (n.j || n.pad !== pad) continue;
        const d = Math.abs(songT - n.t);
        if (d < bd) { bd = d; best = n; }
      }
      const fl = this.$.padParts[pad].fl;
      fl.style.transition = 'none'; fl.style.opacity = '0.55';
      requestAnimationFrame(() => { fl.style.transition = 'opacity .18s'; fl.style.opacity = '0'; });
      if (best && bd <= WIN.good * wm) {
        // early hits land exactly on the grid; late hits play right away
        this.sound(pad, Math.max(ctx.currentTime, this.startAt + best.t), best.vel, best.dur);
        this.judge(best, bd <= WIN.perfect * wm ? 'perfect' : bd <= WIN.great * wm ? 'great' : 'good');
        return;
      }
      this.sound(pad, ctx.currentTime, 0.6, 0.25);
      const ph = this.chart.timeline[this.phaseIdx];
      if (ph && ph.kind === 'resp' && this.chart.diff.stray) { // off-pattern tap during your turn (Turbo/Hyper)
        this.counts.stray++; this.combo = 0; this.paintScore();
        this.push(-0.5 * this.norm);
      }
    }

    judge(n, j) {
      n.j = j;
      const now = this.audio.ctx.currentTime;
      const ab = now < this.abilityUntil ? this.abilityKind : null;
      if (j === 'miss') {
        this.counts.miss++; this.combo = 0;
        if (ab !== 'industrial') { this.push(-(this.chart.diff.miss || 1.6) * this.norm); this.audio.missChoke(); this.anim(this.$.you, 'hurt'); }
        this.showJudge('MISS', '#FF5FA2');
        this.paintScore();
        return;
      }
      const J = JUDGE[j];
      this.counts[j]++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mult = Math.min(4, 1 + Math.floor(this.combo / 10) * 0.5);
      let pts = J.pts * mult;
      if (ab === 'alchemist') pts *= 1.25;
      if (ab === 'biomech') pts *= 2;
      this.score += Math.round(pts);
      let dmg = J.dmg * this.norm * (this.me.atk / this.rv.def);
      if (ab === 'dub') dmg *= 2;
      if (ab === 'industrial') dmg *= 1.5;
      this.push(dmg);
      if (ab == null) { this.meter = Math.min(100, this.meter + J.meter); this.paintAbility(); }
      this.showJudge(this.combo >= 10 && j === 'perfect' ? `PERFECT x${this.combo}` : J.text, J.color);
      this.anim(this.$.you, 'atk'); this.anim(this.$.rival, 'hurt');
      this.paintScore();
    }

    useAbility() {
      if (!this.running || this.meter < 100 || this.abilityUntil > 0) return;
      const now = this.audio.ctx.currentTime;
      const ph = this.chart.timeline[this.phaseIdx];
      this.meter = 0; this.abilityKind = this.me.key;
      this.abilityUntil = now + (ph ? (ph.t1 - ph.t0) * 2 : 8);
      if (this.abilityKind === 'alchemist') this.push(10);
      const A = this.audio;
      const crash = { s: 'pads/crash.wav', g: 0.45, rev: 0.3, fx: true };
      if (!A.buf[crash.s]) A.load(crash.s).then(() => A.hit(crash, null, A.ctx.currentTime, 1)); else A.hit(crash, null, now, 1);
      if (A.buf['pads/timpani.wav']) A.hit({ s: 'pads/timpani.wav', g: 0.7, fx: true }, null, now, 1);
      this.banner(ABILITY[this.abilityKind].name, '#00E5FF');
      this.ui.classList.remove('shake'); void this.ui.offsetWidth; this.ui.classList.add('shake');
      this.paintAbility();
    }

    push(v) { this.tug = Math.max(0, Math.min(100, this.tug + v)); }
    paintScore() { this.$.score.textContent = this.score.toLocaleString(); this.$.combo.textContent = this.combo; }
    paintAbility() {
      const live = this.abilityUntil > 0;
      const lit = live ? 20 : Math.floor(this.meter / 5);
      this.$.meter.forEach((m, i) => m.classList.toggle('on', i < lit));
      const b = this.$.abtn;
      b.classList.toggle('ready', !live && this.meter >= 100);
      b.classList.toggle('live', live);
      b.textContent = live ? 'ABILITY LIVE' : this.meter >= 100 ? 'ABILITY READY [SPACE]' : 'ABILITY [SPACE]';
    }
    showJudge(txt, color) {
      const j = this.$.judge; j.textContent = txt; j.style.color = color;
      j.classList.remove('show'); void j.offsetWidth; j.classList.add('show');
    }
    banner(txt, color) {
      const b = this.$.banner; b.textContent = txt; b.style.color = color || '#00E5FF';
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    }
    anim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
    flashMini(pad, cls) { const m = this.$.mini[pad]; m.classList.add(cls); setTimeout(() => m.classList.remove(cls), 130); }
    ghost(pad) {
      const g = this.$.padParts[pad].gh;
      g.style.transition = 'none'; g.style.opacity = '0.9';
      requestAnimationFrame(() => { g.style.transition = 'opacity .32s'; g.style.opacity = '0'; });
    }
    toast(msg) { this.banner(msg, '#FFB020'); }

    end(reason) {
      if (!this.running) return;
      this.setRunning(false);
      clearInterval(this.timer); cancelAnimationFrame(this.raf);
      const A = this.audio, now = A.ctx.currentTime;
      A.stopCrackle();
      if (this.track) { try { this.track.stop(now + 0.9); } catch (e) { /* noop */ } this.track = null; }
      this.$.padParts.forEach((p) => p.rg.forEach((r) => { r.style.opacity = '0'; }));
      if (reason === 'quit') { A.tapeStop(now); this.showSetup(); return; }
      const ko = reason === 'ko-win' || reason === 'ko-lose';
      if (ko) {
        A.tapeStop(now);
        A.hit({ s: 'pads/timpani.wav', g: 0.8, fx: true }, null, now, 1);
        (reason === 'ko-win' ? this.$.rival : this.$.you).classList.add('ko');
        this.banner('K.O.!', reason === 'ko-win' ? '#00E5FF' : '#FF2BD6');
      }
      const win = reason === 'ko-win' || (reason === 'done' && this.tug > 50);
      const draw = reason === 'done' && Math.abs(this.tug - 50) < 0.5;
      const total = this.notes.length;
      const judged = this.notes.filter((n) => n.j).length || 1;
      const c = this.counts;
      const acc = Math.round(((c.perfect + c.great * 0.8 + c.good * 0.5) / judged) * 100);
      const grade = acc >= 96 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 68 ? 'C' : 'D';
      const scrap = Math.round(this.score / 120) + (win ? 60 : 15) + (reason === 'ko-win' ? 30 : 0);
      const key = `pb-best-${this.song.id}-${this.setup.diff}`;
      const best = Math.max(store.get(key, 0), this.score);
      store.set(key, best);
      const title = draw ? 'DRAW' : reason === 'ko-win' ? 'K.O. VICTORY' : reason === 'ko-lose' ? 'KNOCKED OUT' : win ? 'VICTORY' : 'DEFEATED';
      const color = draw ? '#7F8DB5' : win ? '#00E5FF' : '#FF2BD6';
      setTimeout(() => {
        this.$.ov.innerHTML = `
          <div class="pb-h" style="color:${color}">${title}</div>
          <div class="pb-grade" style="color:${color}">${grade}</div>
          <div class="pb-sub">${esc(this.me.name || this.me.short + '-01')} vs ${esc(this.rv.name)} · ${esc(this.song.title)} · ${DIFFS[this.setup.diff].label}</div>
          <div class="pb-res">
            <span>ACCURACY</span><b>${acc}%</b>
            <span>PERFECT / GREAT</span><b>${c.perfect} / ${c.great}</b>
            <span>GOOD / MISS</span><b>${c.good} / ${c.miss + (total - judged > 0 ? 0 : 0)}</b>
            <span>MAX COMBO</span><b>${this.maxCombo}</b>
            <span>SCORE</span><b>${this.score.toLocaleString()}</b>
            <span>BEST</span><b>${best.toLocaleString()}</b>
            <span>$SCRAP (preview)</span><b style="color:#3CFFB4">+${scrap}</b>
          </div>
          <div class="pb-btns"><button type="button" class="pb-go pb-again">▶ Rematch</button><button type="button" class="pb-btn2 pb-change">Change setup</button></div>`;
        this.$.ov.classList.remove('hide');
        this.$.ov.querySelector('.pb-again').addEventListener('click', (e) => this.start(e.currentTarget));
        this.$.ov.querySelector('.pb-change').addEventListener('click', () => this.showSetup());
        this.lastResult = { reason, win, draw, acc, grade, score: this.score, counts: Object.assign({}, c), maxCombo: this.maxCombo, notes: total, tug: this.tug };
      }, ko ? 1300 : 400);
    }
  }

  // Offline render of a full song played perfectly (QA + preview exports)
  async function renderSong(id, opts) {
    const o = Object.assign({ diff: 'standard', sampleRate: 44100, kitBase: 'kits/' }, opts || {});
    const song = SONGS.find((s) => s.id === id) || SONGS[0];
    const c = compile(song, o.diff);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(o.sampleRate * (c.total + 3)), o.sampleRate);
    const A = new PBAudio(ctx, o.kitBase);
    A.bpm = song.bpm; A.setTempo(song.bpm, song.delayNote);
    await A.loadSong(song);
    const lead = 0.3;
    if (song.crackle) A.startCrackle(lead);
    [...c.backing.map((e) => Object.assign({ v: 0.92 }, e)), ...c.rival, ...c.player].sort((a, b) => a.t - b.t).forEach((e) => {
      const p = song.pads[ROLES[e.pad]];
      A.hit(song.inst[p.inst], p.note, lead + e.t, e.vel * (e.v || 1), e.dur);
    });
    return ctx.startRendering();
  }

  let instance = null;
  window.BBPadBattle = {
    SONGS, DIFFS, ROLES, KEYS, compile, renderSong,
    mount(root, opts) { instance = new PadBattle(root, opts); return instance; },
    get game() { return instance; },
    selectBot(clan) { if (instance) instance.selectBot(clan); },
  };
})();
