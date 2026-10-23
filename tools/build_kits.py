#!/usr/bin/env python3
"""Build the per-clan starter sample kits.

Each clan gets its own folder: site-src/kits/<clan>/
  <slot files>.wav   trimmed, peak-normalised, faded, 44.1 kHz 16-bit mono
  kit.json           which file plays for each sequencer track/model (+ FX overrides)
  LICENSE.txt        source and license of every file in the folder

Sources (must stay redistributable — they are served publicly):
  808 = TR-808 set by Michael Fischer (1994), distributed with no licensing restrictions
        (via npm @fluid-music/tr-808)
  vc  = Versilian Community Sample Library (VCSL), CC0 1.0 (github.com/sgossner/VCSL)

Usage: build_kits.py <tr808 package dir> <vcsl checkout> <out kits dir>
Swap a sound by editing KITS below (or drop your own file in a clan folder and point kit.json at it).
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

T808, VCSL, OUT = sys.argv[1:4]
SR = 44100

V = {  # VCSL folder shortcuts
    'clap': 'Idiophones/Struck Idiophones/Claps',
    'cow': 'Idiophones/Struck Idiophones/Cowbells',
    'gong': 'Idiophones/Struck Idiophones/Gong 1',
    'anvil': 'Idiophones/Struck Idiophones/Anvil',
    'brake': 'Idiophones/Struck Idiophones/Brake Drum',
    'hh': 'Idiophones/Struck Idiophones/Hi-Hat Cymbal',
    'shk': 'Idiophones/Struck Idiophones/Shaker, Small',
    'wood': 'Idiophones/Struck Idiophones/Woodblock',
    'slit': 'Idiophones/Struck Idiophones/Slit Drum',
    'clv': 'Idiophones/Struck Idiophones/Claves',
    'tamb': 'Idiophones/Struck Idiophones/Tambourine 1',
    'bongo': 'Membranophones/Struck Membranophones/Bongos',
    'conga': 'Membranophones/Struck Membranophones/Conga',
    'darb': 'Membranophones/Struck Membranophones/Darbuka',
    'frame': 'Membranophones/Struck Membranophones/Frame Drum',
    'snare': 'Membranophones/Struck Membranophones/Snare Drum, Modern 1',
    'rope': 'Membranophones/Struck Membranophones/Snare Drum, Rope Tension',
    'tom': 'Membranophones/Struck Membranophones/Tom 1',
    'fmp': 'Electrophones/TX81Z/FM Piano',
}


def s808(rel):
    return ('808', os.path.join(T808, 'TR808WAV', rel))


def vc(folder, name):
    return ('vc', os.path.join(VCSL, V[folder], name))


# Max length (s) per slot type
MAXLEN = {'kick': 1.1, 'kick_long': 1.6, 'snare': 0.6, 'clap': 0.5, 'rim': 0.3, 'hat': 0.3, 'ohat': 0.9,
          'shaker': 0.5, 'perc': 0.7, 'bass': 2.2, 'keys': 2.6, 'tom': 0.9, 'fx': 2.0, 'gong': 6.0}

FMP_MULTI = [('keys_C3.wav', vc('fmp', 'FMPiano_C3_vl2.wav'), 48), ('keys_C4.wav', vc('fmp', 'FMPiano_C4_vl2.wav'), 60)]

# track index -> model -> (out file, source, slot type)   [bass/keys carry a root MIDI note]
KITS = {
    'bboy': {
        'name': 'Intergalactic B-Boys — boom-bap street kit',
        'tracks': {
            0: {'sub': ('kick_sub.wav', s808('BD/BD0075.WAV'), 'kick_long'), 'punch': ('kick_punch.wav', s808('BD/BD2510.WAV'), 'kick'), 'hard': ('kick_hard.wav', s808('BD/BD5025.WAV'), 'kick')},
            1: {'crisp': ('snare_crisp.wav', vc('snare', 'Snare2_HitSN_v5_rr1_Mid.wav'), 'snare'), 'clap': ('snare_clap.wav', vc('clap', 'Clap_rr1.wav'), 'clap'), 'rim': ('snare_rim.wav', s808('RS/RS.WAV'), 'rim')},
            2: {'closed': ('hat_closed.wav', s808('CH/CH.WAV'), 'hat'), 'open': ('hat_open.wav', s808('OH/OH25.WAV'), 'ohat'), 'shaker': ('hat_shaker.wav', vc('shk', 'Mid_ShakerHighFaster_Down_rr1.wav'), 'shaker')},
            3: {'cowbell': ('perc_cowbell.wav', s808('CB/CB.WAV'), 'perc'), 'bongo': ('perc_bongo.wav', vc('bongo', 'BongoH_Hit1_v2_rr1_Mid.wav'), 'perc'), 'wood': ('perc_wood.wav', vc('wood', 'wood_click_f_rr1.wav'), 'perc')},
            4: {'sine': ('bass_808.wav', s808('BDTuned/BD0010-g1.wav'), 'bass', 31.31)},
            5: {'soul': 'FMP'},
            7: {'tom': ('glitch_tom.wav', s808('LT/LT50.WAV'), 'tom')},
        },
        'fx': {},
    },
    'dub': {
        'name': '140 Dub Operators — sound-system kit',
        'tracks': {
            0: {'sub': ('kick_sub.wav', s808('BD/BD0075.WAV'), 'kick_long'), 'punch': ('kick_punch.wav', s808('BD/BD1050.WAV'), 'kick_long'), 'hard': ('kick_hard.wav', s808('BD/BD2525.WAV'), 'kick')},
            1: {'crisp': ('snare_crisp.wav', vc('rope', 'Hi/RopeSnare_hi_sn_Main_vl3_rr1.wav'), 'snare'), 'clap': ('snare_clap.wav', s808('CP/CP.WAV'), 'clap'), 'rim': ('snare_rim.wav', s808('RS/RS.WAV'), 'rim')},
            2: {'closed': ('hat_closed.wav', s808('CH/CH.WAV'), 'hat'), 'open': ('hat_open.wav', s808('OH/OH50.WAV'), 'ohat'), 'shaker': ('hat_shaker.wav', s808('MA/MA.WAV'), 'shaker')},
            3: {'cowbell': ('perc_claves.wav', vc('clv', 'Claves1_Hit_v2_rr1_Mid.wav'), 'perc'), 'bongo': ('perc_conga.wav', s808('HC/HC25.WAV'), 'perc'), 'wood': ('perc_wood.wav', vc('wood', 'wood_click_mp.wav'), 'perc')},
            4: {'sine': ('bass_808.wav', s808('BDTuned/BD2510-g1.wav'), 'bass', 31.31)},
            5: {'soul': 'FMP'},
            7: {'tom': ('glitch_tom.wav', s808('LT/LT75.WAV'), 'tom')},
        },
        'fx': {},
    },
    'alchemist': {
        'name': 'Electro-Soul Alchemists — live-room soul kit',
        'tracks': {
            0: {'sub': ('kick_sub.wav', s808('BD/BD0050.WAV'), 'kick_long'), 'punch': ('kick_punch.wav', s808('BD/BD1025.WAV'), 'kick'), 'hard': ('kick_hard.wav', s808('BD/BD5010.WAV'), 'kick')},
            1: {'crisp': ('snare_crisp.wav', vc('snare', 'Snare2_HitNS_v5_rr1_Mid.wav'), 'snare'), 'clap': ('snare_clap.wav', vc('clap', 'Clap_rr3.wav'), 'clap'), 'rim': ('snare_rim.wav', vc('clv', 'Claves2_Hit_v2_rr1_Mid.wav'), 'rim')},
            2: {'closed': ('hat_closed.wav', vc('hh', 'HiHat_HitC_v3_rr1_Mid.wav'), 'hat'), 'open': ('hat_open.wav', vc('hh', 'HiHat_HitO_rr1_Mid.wav'), 'ohat'), 'shaker': ('hat_tamb.wav', vc('tamb', 'Tamb1_Shake_rr1_Mid.wav'), 'shaker')},
            3: {'cowbell': ('perc_cowbell.wav', vc('cow', 'Cowbell1_Muted_v2_rr1_Mid.wav'), 'perc'), 'bongo': ('perc_conga.wav', vc('conga', 'Conga_HitN_v2_rr1_Sum.wav'), 'perc'), 'wood': ('perc_wood.wav', vc('wood', 'wood_click_pp_rr1.wav'), 'perc')},
            5: {'soul': 'FMP'},
            7: {'tom': ('glitch_tom.wav', vc('tom', 'Mallet/TomH_HitM_v3_rr1_Mid.wav'), 'tom')},
        },
        'fx': {},
    },
    'industrial': {
        'name': 'Industrial Mecha — foundry metal kit',
        'tracks': {
            0: {'sub': ('kick_sub.wav', s808('BD/BD5050.WAV'), 'kick_long'), 'punch': ('kick_punch.wav', s808('BD/BD5025.WAV'), 'kick'), 'hard': ('kick_hard.wav', s808('BD/BD5010.WAV'), 'kick')},
            1: {'crisp': ('snare_crisp.wav', vc('snare', 'Snare2_HitSN_v6_rr1_Mid.wav'), 'snare'), 'clap': ('snare_clap.wav', vc('clap', 'Clap_rr5.wav'), 'clap'), 'rim': ('snare_anvil.wav', vc('anvil', 'Anvil_Hit1_v2_rr1_Mid.wav'), 'rim')},
            2: {'closed': ('hat_closed.wav', vc('hh', 'HiHat_HitC_v4_rr1_Mid.wav'), 'hat'), 'open': ('hat_open.wav', vc('hh', 'HiHat_HitLoose_rr1_Mid.wav'), 'ohat'), 'shaker': ('hat_shaker.wav', vc('shk', 'Mid_ShakerDouble_Down_rr1.wav'), 'shaker')},
            3: {'cowbell': ('perc_anvil.wav', vc('anvil', 'Anvil_Hit2_v3_rr1_Mid.wav'), 'perc'), 'bongo': ('perc_brake.wav', vc('brake', 'BrakeDrum1_Hammer_v3_rr1_Mid.wav'), 'perc'), 'wood': ('perc_brake2.wav', vc('brake', 'BrakeDrum2_Hammer1_v2_rr1_Mid.wav'), 'perc')},
            7: {'tom': ('glitch_tom.wav', vc('tom', 'Stick/TomH_HitS_v4_rr1_Mid.wav'), 'tom')},
        },
        'fx': {'metal': ('fx_metal.wav', vc('anvil', 'Anvil_Hit3_v3_rr1_Mid.wav'), 'fx')},
    },
    'biomech': {
        'name': 'Polyrhythmic Biomechs — ritual hand-drum kit',
        'tracks': {
            0: {'sub': ('kick_sub.wav', s808('BD/BD0075.WAV'), 'kick_long'), 'punch': ('kick_frame.wav', vc('frame', 'HDrumL_Hit_v3_rr1_Sum.wav'), 'kick'), 'hard': ('kick_hard.wav', s808('BD/BD2550.WAV'), 'kick_long')},
            1: {'crisp': ('snare_darbuka.wav', vc('darb', 'Darbuka_1_hit_vl2_rr1.wav'), 'snare'), 'clap': ('snare_darbuka2.wav', vc('darb', 'Darbuka_3_hit_vl2_rr1.wav'), 'snare'), 'rim': ('snare_slit.wav', vc('slit', 'LogDrumHi_MedM_v2_rr1_Sum.wav'), 'rim')},
            2: {'closed': ('hat_closed.wav', vc('hh', 'HiHat_HitC_v2_rr1_Mid.wav'), 'hat'), 'open': ('hat_open.wav', vc('hh', 'HiHat_HitO_rr2_Mid.wav'), 'ohat'), 'shaker': ('hat_shaker.wav', vc('shk', 'Mid_ShakerLowFaster_Up_rr1.wav'), 'shaker')},
            3: {'cowbell': ('perc_cowbell.wav', vc('cow', 'Cowbell2_Muted_v3_rr1_Mid.wav'), 'perc'), 'bongo': ('perc_bongo.wav', vc('bongo', 'BongoH_HitMuted1_v2_rr1_Mid.wav'), 'perc'), 'wood': ('perc_slit.wav', vc('slit', 'LogDrumLo_MedM_v2_rr1_Sum.wav'), 'perc')},
            7: {'tom': ('glitch_tom.wav', vc('tom', 'Mallet/TomH_HitM_v4_rr1_Mid.wav'), 'tom')},
        },
        'fx': {'gong': ('fx_gong.wav', vc('gong', 'gong_f.wav'), 'gong')},
    },
}

LICENSE_TEXT = {
    '808': 'TR-808 sample set by Michael Fischer (1994, machines.hyperreal.org), distributed with no licensing restrictions; packaged as npm @fluid-music/tr-808 (ISC).',
    'vc': 'Versilian Community Sample Library (VCSL) by Versilian Studios — CC0 1.0 Universal (public domain dedication). https://github.com/sgossner/VCSL',
}


def load(path):
    """Decode any audio to float32 mono at 44.1 kHz via ffmpeg."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def process(x, kind):
    peak = float(np.max(np.abs(x))) or 1.0
    thr = peak * 10 ** (-50 / 20)
    idx = np.nonzero(np.abs(x) > thr)[0]
    if len(idx) == 0:
        raise ValueError('silent file')
    start = max(0, idx[0] - int(0.001 * SR))
    end = idx[-1] + 1
    x = x[start:end]
    x = x[: int(MAXLEN[kind] * SR)]
    fade = min(len(x) // 6, int((0.03 if kind not in ('gong', 'keys', 'bass') else 0.25) * SR))
    if fade > 0:
        x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x[: int(0.0005 * SR)] *= np.linspace(0, 1, int(0.0005 * SR))  # 0.5 ms de-click
    x = x / (np.max(np.abs(x)) or 1) * 10 ** (-1 / 20)  # peak -1 dBFS
    return x


def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def build():
    summary = {}
    for clan, kit in KITS.items():
        folder = os.path.join(OUT, clan)
        os.makedirs(folder, exist_ok=True)
        for f in os.listdir(folder):
            if f.endswith('.wav'):
                os.remove(os.path.join(folder, f))
        manifest = {'clan': clan, 'name': kit['name'], 'version': 1, 'tracks': {}, 'fx': {}}
        credits = []

        def emit(out, src, kind, root=None):
            lib, path = src
            x = process(load(path), kind)
            write(os.path.join(folder, out), x)
            credits.append(f'{out}  <-  {os.path.relpath(path, T808 if lib == "808" else VCSL)}  [{lib}]')
            entry = {'file': out}
            if root is not None:
                entry['root'] = root
            return entry, len(x) / SR

        total = 0.0
        for tr, models in kit['tracks'].items():
            manifest['tracks'][str(tr)] = {}
            for model, spec in models.items():
                if spec == 'FMP':
                    multi = []
                    for out, src, root in FMP_MULTI:
                        e, d = emit(out, src, 'keys', root); multi.append(e); total += d
                    manifest['tracks'][str(tr)][model] = {'multi': multi}
                else:
                    out, src, kind = spec[:3]
                    root = spec[3] if len(spec) > 3 else None
                    e, d = emit(out, src, kind, root); total += d
                    manifest['tracks'][str(tr)][model] = e
        gains = {}
        gpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kit_gains.json')
        if os.path.exists(gpath):
            gains = json.load(open(gpath)).get(clan, {})
        for tr, models in gains.items():
            for model, g in models.items():
                e = manifest['tracks'].get(tr, {}).get(model)
                if e and 'file' in e:
                    e['gain'] = g
        for fx, (out, src, kind) in kit['fx'].items():
            e, d = emit(out, src, kind); total += d
            manifest['fx'][fx] = e
        with open(os.path.join(folder, 'kit.json'), 'w') as f:
            json.dump(manifest, f, indent=2)
        used = sorted({c.rsplit('[', 1)[1].rstrip(']') for c in credits})
        with open(os.path.join(folder, 'LICENSE.txt'), 'w') as f:
            f.write(f'BeatBots starter kit: {kit["name"]}\n\nSources:\n')
            for lib in used:
                f.write(f'  [{lib}] {LICENSE_TEXT[lib]}\n')
            f.write('\nFiles (processed: trimmed, peak-normalised, faded, 44.1 kHz mono):\n')
            f.write('\n'.join('  ' + c for c in credits) + '\n')
        size = sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder))
        summary[clan] = (len(credits), round(total, 1), round(size / 1e6, 2))
    for clan, (n, secs, mb) in summary.items():
        print(f'{clan:11} {n:2} files  {secs:5}s audio  {mb} MB')


if __name__ == '__main__':
    build()
