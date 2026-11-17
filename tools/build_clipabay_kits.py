#!/usr/bin/env python3
"""Upgrade the per-clan kits with the Clipabay Free Drum Kit (CC0) and trim every kit sample.

    python3 tools/build_clipabay_kits.py "<extracted 'Clipabay Free Drum Kit' folder>" site-src/kits

What it does
  1. Writes the 12 tuned Clipabay 808s once to kits/_shared/808_<note>.wav and points every clan's
     Sub Synth "sine" model at them as a multisample (the engine picks the nearest note, so the
     bassline is played from real notes instead of one sample stretched across two octaves).
  2. Replaces the drum slots listed in SLOTS below with Clipabay one-shots, chosen per clan style.
     Slots not listed keep their current sound (e.g. Industrial anvils, Biomech hand drums, gong).
  3. Trims leading silence from EVERY kit sample (new and kept), so hits start on the beat, and
     levels each slot by loudness so a new sample isn't suddenly louder or quieter than before.
  4. Rewrites each clan's kit.json and appends the Clipabay sources to its LICENSE.txt.

Source + license (must stay redistributable; kits are served publicly and exported in WAVs):
  Clipabay Free Drum Kit by Black Ribbon Studios — CC0 1.0 Universal (LICENSE.txt in the zip:
  "waived all copyright ... copy, modify, distribute and use them, even for commercial purposes
  ... No credit needed"). https://clipabay.com/free-drum-kit
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

SRC, KITS = sys.argv[1], sys.argv[2]
SR = 44100
SHARED = os.path.join(KITS, '_shared')

# clan -> track -> model -> Clipabay file (relative to the kit folder)
SLOTS = {
    'bboy': {  # boom-bap street kit
        '0': {'sub': 'Kicks/Kick 05 - Round.wav', 'punch': 'Kicks/Kick 07 - Boom Bap.wav', 'hard': 'Kicks/Kick 10 - Hard.wav'},
        '1': {'crisp': 'Snares/Snare 06 - Lofi.wav', 'clap': 'Claps/Clap 01 - Classic.wav', 'rim': 'Percussion/Rim.wav'},
        '2': {'closed': 'Hats/Hat 05 - Closed Dark.wav', 'open': 'Hats/Open Hat 04 - Open Dark.wav', 'shaker': 'Percussion/Shaker.wav'},
        '3': {'cowbell': 'Percussion/Cowbell.wav', 'bongo': 'Percussion/Conga High.wav', 'wood': 'Percussion/Woodblock.wav'},
        '7': {'tom': 'Percussion/Tom Mid.wav'},
    },
    'dub': {  # 140 sound-system / trap weight
        '0': {'sub': 'Kicks/Kick 02 - Deep.wav', 'punch': 'Kicks/Kick 08 - Trap.wav', 'hard': 'Kicks/Kick 04 - Distorted.wav'},
        '1': {'crisp': 'Snares/Snare 05 - Trap.wav', 'clap': 'Claps/Clap 05 - Low.wav', 'rim': 'Snares/Snare 07 - Rim Snare.wav'},
        '2': {'closed': 'Hats/Hat 08 - Closed Trap.wav', 'open': 'Hats/Open Hat 03 - Open Short.wav', 'shaker': 'Percussion/Tambourine.wav'},
        '3': {'cowbell': 'Percussion/Clave.wav', 'bongo': 'Percussion/Conga Low.wav'},
        '7': {'tom': 'Percussion/Tom Low.wav'},
    },
    'alchemist': {  # live-room electro-soul
        '0': {'sub': 'Kicks/Kick 09 - Soft.wav', 'punch': 'Kicks/Kick 01 - Punchy.wav', 'hard': 'Kicks/Kick 06 - Clicky.wav'},
        '1': {'crisp': 'Snares/Snare 04 - Roomy.wav', 'clap': 'Claps/Clap 04 - Verb.wav', 'rim': 'Percussion/Snap.wav'},
        '2': {'closed': 'Hats/Hat 03 - Closed Loose.wav', 'open': 'Hats/Open Hat 01 - Open.wav'},
        '7': {'tom': 'Percussion/Tom High.wav'},
    },
    'industrial': {  # foundry: hard drums, keeps its anvils/brake drums
        '0': {'sub': 'Kicks/Kick 03 - Short.wav', 'punch': 'Kicks/Kick 10 - Hard.wav', 'hard': 'Kicks/Kick 04 - Distorted.wav'},
        '1': {'crisp': 'Snares/Snare 03 - Crack.wav', 'clap': 'Claps/Clap 02 - Tight.wav'},
        '2': {'closed': 'Hats/Hat 06 - Closed Bright.wav', 'open': 'Hats/Open Hat 05 - Open Bright.wav', 'shaker': 'Hats/Hat 07 - Closed Noisy.wav'},
    },
    'biomech': {  # ritual hand drums stay; only the kick body and hats get help
        '0': {'sub': 'Kicks/Kick 02 - Deep.wav', 'hard': 'Kicks/Kick 05 - Round.wav'},
        '2': {'closed': 'Hats/Hat 01 - Closed Tight.wav', 'open': 'Hats/Open Hat 02 - Open Long.wav'},
    },
}
BASS_808 = {  # note name -> MIDI (C4 = 60)
    'F1': 29, 'F#1': 30, 'G1': 31, 'G#1': 32, 'A1': 33, 'A#1': 34, 'B1': 35,
    'C2': 36, 'C#2': 37, 'D2': 38, 'D#2': 39, 'E2': 40,
}
MAXLEN = {'0': 1.1, '1': 0.7, '2': 0.45, '3': 0.6, '7': 0.9, 'open': 1.0, 'bass': 2.2}
# target loudness (RMS of the first 150 ms, dBFS) per track, so swaps keep the existing mix balance
TARGET_DB = {'0': -11.0, '1': -13.5, '2': -19.0, '3': -17.0, '7': -14.0}
FILENAME = {  # model -> output file name (matches the existing slot names)
    ('0', 'sub'): 'kick_sub.wav', ('0', 'punch'): 'kick_punch.wav', ('0', 'hard'): 'kick_hard.wav',
    ('1', 'crisp'): 'snare_crisp.wav', ('1', 'clap'): 'snare_clap.wav', ('1', 'rim'): 'snare_rim.wav',
    ('2', 'closed'): 'hat_closed.wav', ('2', 'open'): 'hat_open.wav', ('2', 'shaker'): 'hat_shaker.wav',
    ('3', 'cowbell'): 'perc_cowbell.wav', ('3', 'bongo'): 'perc_bongo.wav', ('3', 'wood'): 'perc_wood.wav',
    ('7', 'tom'): 'glitch_tom.wav',
}


def load(path):
    y, sr = sf.read(path, dtype='float32', always_2d=True)
    y = y.mean(axis=1)  # mono: kits play through a mono-summed chain anyway
    if sr != SR:
        n = int(round(len(y) * SR / sr))
        y = np.interp(np.linspace(0, len(y) - 1, n), np.arange(len(y)), y).astype('float32')
    return y


def trim_start(y, thresh_db=-42.0, pre_ms=0.6):
    """Cut leading silence: start ~0.6 ms before the first sample above the threshold."""
    peak = np.max(np.abs(y)) or 1.0
    above = np.nonzero(np.abs(y) >= peak * 10 ** (thresh_db / 20))[0]
    if not len(above):
        return y, 0.0
    start = max(0, above[0] - int(SR * pre_ms / 1000))
    return y[start:], start / SR


def shape(y, maxlen):
    y = y[: int(SR * maxlen)]
    fade = min(len(y) // 4, int(SR * 0.03))
    if fade > 0:
        y[-fade:] *= np.linspace(1, 0, fade, dtype='float32')
    peak = np.max(np.abs(y)) or 1.0
    return (y / peak * 10 ** (-1 / 20)).astype('float32')  # peak -1 dBFS


def rms_db(y):
    seg = y[: int(SR * 0.15)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)


def write(path, y):
    sf.write(path, y, SR, subtype='PCM_16')


def main():
    os.makedirs(SHARED, exist_ok=True)
    bass_multi = []
    for name, midi in BASS_808.items():
        y, _ = trim_start(load(os.path.join(SRC, '808s', f'808 - {name}.wav')))
        out = f'808_{name.replace("#", "s")}.wav'
        write(os.path.join(SHARED, out), shape(y, MAXLEN['bass']))
        bass_multi.append({'file': f'../_shared/{out}', 'root': midi})
    with open(os.path.join(SHARED, 'LICENSE.txt'), 'w') as f:
        f.write('Shared samples used by several clan kits.\n\n'
                'Source: Clipabay Free Drum Kit by Black Ribbon Studios, CC0 1.0 Universal (public domain\n'
                'dedication; commercial use and redistribution allowed, no credit needed).\n'
                'https://clipabay.com/free-drum-kit\n\nFiles (trimmed, peak -1 dBFS, 44.1 kHz 16-bit mono):\n')
        for z, (name, _) in zip(bass_multi, BASS_808.items()):
            f.write(f'  {os.path.basename(z["file"])}  <-  808s/808 - {name}.wav\n')

    report = []
    for clan in ('bboy', 'dub', 'alchemist', 'industrial', 'biomech'):
        d = os.path.join(KITS, clan)
        man = json.load(open(os.path.join(d, 'kit.json')))
        swapped = []
        for track, models in SLOTS.get(clan, {}).items():
            for model, rel in models.items():
                y, _ = trim_start(load(os.path.join(SRC, rel)))
                maxlen = MAXLEN['open'] if model == 'open' else MAXLEN[track]
                y = shape(y, maxlen)
                out = FILENAME[(track, model)]
                write(os.path.join(d, out), y)
                gain = float(np.clip(10 ** ((TARGET_DB[track] - rms_db(y)) / 20), 0.35, 2.6))
                entry = {'file': out}
                if abs(gain - 1) > 0.05:
                    entry['gain'] = round(gain, 2)
                man['tracks'].setdefault(track, {})[model] = entry
                swapped.append((out, rel))
        # tuned 808 multisample for every clan's Sub Synth "sine"
        man['tracks'].setdefault('4', {})['sine'] = {'multi': bass_multi}
        # trim leading silence on every sample this clan still uses from before
        kept = set()
        for models in man['tracks'].values():
            for e in models.values():
                if e.get('file') and not e['file'].startswith('../'):
                    kept.add(e['file'])
                for z in e.get('multi', []):
                    if not z['file'].startswith('../'):
                        kept.add(z['file'])
        for e in man.get('fx', {}).values():
            if e.get('file'):
                kept.add(e['file'])
        new_files = {o for o, _ in swapped}
        trimmed = []
        for fn in sorted(kept - new_files):
            p = os.path.join(d, fn)
            y, sr = sf.read(p, dtype='float32')
            if y.ndim > 1:
                y = y.mean(axis=1)
            y2, cut = trim_start(y)
            if cut > 0.0015:
                sf.write(p, y2, sr, subtype='PCM_16')
                trimmed.append(f'{fn} (-{cut * 1000:.1f} ms)')
        # drop files no slot uses any more
        for fn in os.listdir(d):
            if fn.endswith('.wav') and fn not in kept and fn not in new_files:
                os.remove(os.path.join(d, fn))
        man['version'] = 2
        json.dump(man, open(os.path.join(d, 'kit.json'), 'w'), indent=2)
        lic = os.path.join(d, 'LICENSE.txt')
        txt = open(lic).read().split('\n\n[2026-11 upgrade]')[0]
        txt += ('\n\n[2026-11 upgrade]\n'
                '  [cb] Clipabay Free Drum Kit by Black Ribbon Studios, CC0 1.0 Universal (no credit needed;\n'
                '       commercial use and redistribution allowed). https://clipabay.com/free-drum-kit\n'
                '  These slots now use [cb] files (trimmed, peak -1 dBFS, 44.1 kHz 16-bit mono):\n')
        txt += ''.join(f'    {o}  <-  {r}  [cb]\n' for o, r in swapped)
        txt += '  Sub Synth "sine" plays the tuned [cb] 808s in ../_shared/ (see ../_shared/LICENSE.txt).\n'
        if trimmed:
            txt += '  Kept files with leading silence trimmed: ' + ', '.join(trimmed) + '\n'
        open(lic, 'w').write(txt)
        report.append(f'{clan}: {len(swapped)} slots -> Clipabay, {len(trimmed)} kept files trimmed')
    print('\n'.join(report))


if __name__ == '__main__':
    main()
