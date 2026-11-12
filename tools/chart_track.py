#!/usr/bin/env python3
"""Chart one of Jake's original tracks for the Boombox + Battle Arcade.

    python3 tools/chart_track.py <audio file> --id ways-beyond --title "Lore Title" \
        [--original "Ways Beyond"] [--clan dub] [--bpm 92] [--start 0] [--length 75]

What it does
  1. Transcodes the song to a 192 kbps MP3 at site-src/tracks/<id>.mp3 (the Boombox plays the full song).
  2. Finds the tempo and beat grid (librosa), then the drum/melody onsets.
  3. Snaps onsets to the 8th/16th-note grid and writes three BeatMaps (easy, standard, hard)
     to site-src/tracks/<id>.<difficulty>.json. Lanes follow pitch: low hits -> lane 0 (D),
     mids -> lane 1 (F), highs -> lane 2 (J). Hard adds two-lane chords on accented downbeats.
  4. Adds or updates the entry in site-src/tracks/tracks.json (the Boombox + Arcade manifest).

Charts cover a battle-length window (default: 75 s starting at --start) so a round is not
a 6-minute marathon. The Boombox still plays the whole song.

Music policy: only Jake's own original TecSupport tracks; public titles are lore titles with no
real band/artist names (AGENTS.md section 4).
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import librosa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(ROOT, 'site-src', 'tracks')
CLANS = ('bboy', 'dub', 'alchemist', 'industrial', 'biomech')
CLAN_SCALE = {
    'bboy': {'root': 'A4', 'mode': 'minorPentatonic'}, 'dub': {'root': 'G4', 'mode': 'minorPentatonic'},
    'alchemist': {'root': 'F4', 'mode': 'majorPentatonic'}, 'industrial': {'root': 'D4', 'mode': 'phrygian'},
    'biomech': {'root': 'D4', 'mode': 'minor'},
}
# min spacing between notes (in beats) and max share of grid slots used, per difficulty
DIFFS = {
    'easy':     {'grid': 0.5,  'min_gap': 1.0,  'keep': 0.35, 'chords': False},
    'standard': {'grid': 0.5,  'min_gap': 0.5,  'keep': 0.6,  'chords': False},
    'hard':     {'grid': 0.25, 'min_gap': 0.25, 'keep': 0.8,  'chords': True},
}


def transcode(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '2', '-ar', '44100',
                    '-b:a', '192k', '-map_metadata', '-1', dst], check=True)


def analyse(path, start, length, bpm_hint):
    y, sr = librosa.load(path, sr=22050, mono=True, offset=start, duration=length)
    if len(y) < sr * 10:
        sys.exit('chart_track: need at least 10 s of audio in the window')
    hop = 256
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, start_bpm=bpm_hint or 110, units='time')
    tempo = float(np.atleast_1d(tempo)[0])
    if bpm_hint:
        tempo = float(bpm_hint)
    while tempo < 70: tempo *= 2
    while tempo > 180: tempo /= 2
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    on_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=False)
    on_times = librosa.frames_to_time(on_frames, sr=sr, hop_length=hop)
    on_strength = onset_env[on_frames]
    # Fit one straight beat grid across the whole window (time = phase + k * spb). A single tempo
    # estimate can be 0.5% off, which drifts ~0.25 s over a round; a least-squares fit on the strong
    # onsets nailed to their nearest beat removes that drift. Two passes: fit, re-assign, refit.
    spb = 60.0 / tempo
    anchors = np.asarray(beats, dtype=float)
    strong = on_times[on_strength >= np.quantile(on_strength, 0.6)] if len(on_times) else anchors
    pts = np.concatenate([anchors, strong]) if len(strong) else anchors
    phase = float(np.median(np.mod(anchors, spb))) if len(anchors) else 0.0
    for _ in range(3):
        k = np.round((pts - phase) / spb)
        resid = pts - (phase + k * spb)
        keep = np.abs(resid) < 0.06
        if keep.sum() < 8:
            break
        spb, phase = np.polyfit(k[keep], pts[keep], 1)
        spb, phase = float(spb), float(phase)
    phase = phase % spb
    tempo = 60.0 / spb
    if bpm_hint:  # an explicit BPM wins on tempo; the fit still sets the phase
        spb = 60.0 / float(bpm_hint); tempo = float(bpm_hint)
    # spectral centroid at each onset -> lane (low / mid / high)
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    on_cent = cent[np.minimum(on_frames, len(cent) - 1)]
    return {'tempo': tempo, 'spb': spb, 'phase': phase, 'times': on_times, 'strength': on_strength,
            'cent': on_cent, 'dur': len(y) / sr}


def chart(a, diff):
    d = DIFFS[diff]
    spb, phase = a['spb'], a['phase']
    lo, hi = np.percentile(a['cent'], [33, 66]) if len(a['cent']) else (0, 0)
    slots = {}
    for t, s, c in zip(a['times'], a['strength'], a['cent']):
        beat = (t - phase) / spb
        if beat < 0.5:  # skip the very first half-beat (lead-in noise)
            continue
        q = round(beat / d['grid']) * d['grid']
        if abs(beat - q) * spb > 0.07:  # off-grid flams/ghosts: drop
            continue
        lane = 0 if c < lo else (1 if c < hi else 2)
        if q not in slots or s > slots[q][0]:
            slots[q] = (float(s), lane)
    if not slots:
        sys.exit('chart_track: no usable onsets found')
    strengths = np.array([v[0] for v in slots.values()])
    cut = np.quantile(strengths, 1 - d['keep'])
    notes, last = [], -99.0
    for q in sorted(slots):
        s, lane = slots[q]
        if s < cut or q - last < d['min_gap'] - 1e-6:
            continue
        lanes = [lane]
        if d['chords'] and abs(q % 4) < 1e-6 and s >= np.quantile(strengths, 0.9):
            lanes = sorted({lane, (lane + 2) % 3})
        notes.append({'beat': round(q, 4), 'lanes': lanes})
        last = q
    # make sure a lane isn't starved (keeps all three keys in play)
    counts = [sum(lane in n['lanes'] for n in notes) for lane in range(3)]
    if min(counts) < max(1, len(notes) // 12):
        for i, n in enumerate(notes):
            if len(n['lanes']) == 1 and i % 3 == counts.index(min(counts)):
                n['lanes'] = [counts.index(min(counts))]
    return notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio')
    ap.add_argument('--id', required=True)
    ap.add_argument('--title', required=True, help='public lore title')
    ap.add_argument('--original', default='', help="Jake's working title (printed only; never written to the public manifest)")
    ap.add_argument('--clan', default='bboy', choices=CLANS)
    ap.add_argument('--bpm', type=float, default=None, help='override detected tempo')
    ap.add_argument('--start', type=float, default=0.0, help='seconds into the song where the battle starts')
    ap.add_argument('--length', type=float, default=75.0, help='battle length in seconds')
    o = ap.parse_args()

    mp3 = os.path.join(TRACKS, f'{o.id}.mp3')
    transcode(o.audio, mp3)
    a = analyse(mp3, o.start, o.length, o.bpm)
    full_len = float(librosa.get_duration(path=mp3))
    if o.original:
        print(f'working title: {o.original} -> public lore title: {o.title}')
    print(f'{o.id}: tempo {a["tempo"]:.1f} BPM, {len(a["times"])} onsets in {a["dur"]:.0f}s window, song {full_len:.0f}s')

    charts = {}
    for diff in DIFFS:
        notes = chart(a, diff)
        bars = int(np.ceil((notes[-1]['beat'] + 1) / 4))
        bm = {
            'id': f'{o.id}-{diff}', 'title': o.title, 'artist': 'TecSupport', 'clan': o.clan,
            'bpm': round(a['tempo'], 3), 'beatsPerBar': 4, 'bars': bars,
            'scale': CLAN_SCALE[o.clan],
            'audio': {'url': f'tracks/{o.id}.mp3', 'offset': round(o.start + a['phase'], 4), 'gain': 0.9},
            'notes': notes,
        }
        f = os.path.join(TRACKS, f'{o.id}.{diff}.json')
        json.dump(bm, open(f, 'w'), indent=1)
        charts[diff] = f'tracks/{o.id}.{diff}.json'
        print(f'  {diff:8s} {len(notes):4d} notes ({len(notes) / a["dur"]:.2f}/s)')

    man_path = os.path.join(TRACKS, 'tracks.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'tracks': []}
    entry = {'id': o.id, 'title': o.title, 'artist': 'TecSupport', 'clan': o.clan, 'url': f'tracks/{o.id}.mp3',
             'duration': round(full_len, 1), 'bpm': round(a['tempo'], 1), 'charts': charts}
    man['tracks'] = [t for t in man['tracks'] if t['id'] != o.id] + [entry]
    json.dump(man, open(man_path, 'w'), indent=1)
    print(f'  manifest: {len(man["tracks"])} track(s) in site-src/tracks/tracks.json')


if __name__ == '__main__':
    main()
