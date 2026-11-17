#!/usr/bin/env python3
"""Build the Beat Pad Battle instrument samples (site-src/kits/pads/) from VCSL (CC0).

Usage: python3 tools/build_pad_samples.py <vcsl_checkout_dir> [out_dir]

Each source is converted to mono, trimmed, faded, peak-normalised to -1 dBFS and written as
16-bit WAV at 32 kHz (keeps the page light; these are tonal/stab sounds). The detected pitch
of every tonal sample is written to pads.json as its MIDI root, so pitch-shifting is exact.
"""
import json, os, subprocess, sys, tempfile, wave
import numpy as np

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'site-src', 'kits', 'pads')
SR = 32000

P = 'Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_vl2_rr1_{}.wav'
V = 'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/'
S = 'Aerophones/Reed Aerophones/Tenor Saxophone/Staccato/'
K = 'Idiophones/Plucked Idiophones/Kalimba, Kenya/'

def ls(d, needle):
    names = sorted(os.listdir(os.path.join(SRC, d)))
    for n in names:
        if needle in n:
            return d + n
    raise SystemExit(f'missing {needle} in {d}')

# (instrument, out name, source path, seconds kept, tonal?, name hint for the pitch search)
JOBS = []
for n in ['A1', 'C#2', 'F2', 'A2', 'C#3', 'F3', 'A3', 'C#4', 'F4', 'A4']:
    JOBS.append(('piano', f'piano_{n.replace("#", "s")}.wav', P.format(n), 1.7, n))
for n in ['C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5']:
    JOBS.append(('vibes', f'vibes_{n}.wav', ls(V, f'Vibes_soft_{n}_v2'), 1.8, n))
for n in ['C3_vl2', 'E3_vl2', 'G#3_vl1', 'C4_vl2', 'E4_vl2']:
    JOBS.append(('horn', f'horn_{n.split("_")[0].replace("#", "s")}.wav', ls(S, f'Main_{n}'), 0.55, n.split('_')[0]))
JOBS.append(('crash', 'crash.wav', 'Idiophones/Struck Idiophones/Clash Cymbals 1/cymbal_crash1_mf1.wav', 2.2, None))
JOBS.append(('crash', 'crash_short.wav', 'Idiophones/Struck Idiophones/Clash Cymbals 1/cymbal_crash1_short1.wav', 0.8, None))
JOBS.append(('impact', 'timpani.wav', 'Membranophones/Struck Membranophones/Timpani 1/Hit/Timpani1_Hit_v4_rr1_Sum.wav', 1.6, None))

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def name_midi(n):
    pc = NOTE[n[0]] + (1 if '#' in n else 0)
    return 12 * (int(n.lstrip('ABCDEFG#')) + 1) + pc

def load(path):
    with tempfile.NamedTemporaryFile(suffix='.raw') as t:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', t.name], check=True)
        return np.fromfile(t.name, dtype=np.float32)

def detect_midi(x, hint):
    """Autocorrelation pitch on a steady chunk, snapped to the octave nearest the filename hint."""
    a = int(0.05 * SR); seg = x[a:a + int(0.25 * SR)]
    seg = seg - seg.mean()
    if len(seg) < 2000:
        return None
    f = np.fft.rfft(seg * np.hanning(len(seg)), n=len(seg) * 4)
    ac = np.fft.irfft(np.abs(f) ** 2)[: len(seg)]
    lo, hi = int(SR / 2000), int(SR / 40)
    lag = lo + int(np.argmax(ac[lo:hi]))
    hz = SR / lag
    m = 69 + 12 * np.log2(hz / 440)
    if hint:
        h = name_midi(hint)
        # autocorrelation can lock onto an octave below; fold toward the hint
        while m < h - 6: m += 12
        while m > h + 6: m -= 12
        if abs(m - h) > 0.6:  # locked onto a partial: trust the (VCSL-tuned) filename
            m = h
    return round(float(m), 2)

def write(path, x):
    y = np.clip(x * 32767, -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.tobytes())

os.makedirs(OUT, exist_ok=True)
manifest = {}
lines = []
for inst, out, src, keep, hint in JOBS:
    x = load(os.path.join(SRC, src))
    # trim leading silence (-50 dB)
    thr = np.max(np.abs(x)) * 0.003
    start = max(0, int(np.argmax(np.abs(x) > thr)) - int(0.001 * SR))
    x = x[start: start + int(keep * SR)]
    fade = int(min(0.25, keep * 0.3) * SR)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x[: 32] *= np.linspace(0, 1, 32)
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.891  # -1 dBFS
    write(os.path.join(OUT, out), x)
    root = detect_midi(x, hint) if hint else None
    manifest.setdefault(inst, []).append({'file': out, **({'root': root} if root is not None else {})})
    lines.append(f'  {out}  <-  {src}  [vc]' + (f'  (root MIDI {root})' if root is not None else ''))
    print(out, root, f'{len(x) / SR:.2f}s')

json.dump(manifest, open(os.path.join(OUT, 'pads.json'), 'w'), indent=1)
with open(os.path.join(OUT, 'LICENSE.txt'), 'w') as f:
    f.write('BeatBots Beat Pad Battle instruments: piano, vibes, horn stabs, crash, timpani\n\n')
    f.write('Sources:\n  [vc] Versilian Community Sample Library (VCSL) by Versilian Studios: CC0 1.0 Universal\n')
    f.write('       (public domain dedication). https://github.com/sgossner/VCSL\n\n')
    f.write('Files (processed: mono, trimmed, faded, peak-normalised, 32 kHz 16-bit) built by tools/build_pad_samples.py:\n')
    f.write('\n'.join(lines) + '\n')
