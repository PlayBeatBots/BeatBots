#!/usr/bin/env python3
"""One-time metadata fix (2026-11-17):
1. Swap remaining real names in traits for theme nods (config, manifest, all token JSONs).
2. Rarer tier = strictly better stats: non-overlapping Power Rating bands per tier.
3. Collection: 'Solana Mainnet' -> 'Solana'; config price -> TBD (no public price).
Deterministic (seeded by token id), safe to re-run."""
import json, glob, os, random
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REN = {
 "Beastie Sound Alley": "Brooklyn Sound Alley",
 "Crown Macro-Tech 5000VZ Rig": "Macro-Watt 5000 Power Amp Rig",
 "Holographic Color Map Visor": "Holographic Spectrum Visor",
 "Color Map Modular Arena": "Spectrum Modular Arena",
 "Red Rocks Starlight Stage": "Red Canyon Starlight Amphitheater",
 "Red Dragonfly Stencil Helmet": "Red Winged-Soldier Stencil Helmet",
 "Reanimation Soldier Fuel Cell": "Remix Soldier Fuel Cell",
 "Hybrid Theory Underground Bunker": "Hybrid Rig Underground Bunker",
 "Reanimation Scrap Yard": "Remix Scrap Yard",
 "Stem 03: Reanimation Turntable Scrub": "Stem 03: Remix Turntable Scrub",
 "Lateralus Energy Conduit": "Golden Spiral Energy Conduit",
 "Alex Grey Net of Being Temple": "Visionary Lattice Temple",
 "Net of Being Crown": "Lattice of Being Crown",
 "Lateralus Sacred Geometry Void": "Golden Spiral Sacred Geometry Void",
 "Stem 03: Lateralus Tribal Bass Drone": "Stem 03: Golden Spiral Tribal Bass Drone",
 "V2 ALEX GREY TEMPLE": "V2 VISIONARY TEMPLE",
 "The Dragonfly Reanimator": "The Winged Foundry Revenant",
}
THEME = {"bboy": "Brooklyn boom-bap b-boy crew", "dub": "140 bass-music sound-system rig",
         "alchemist": "Electro-soul modular laser show", "industrial": "Hybrid nu-metal remix foundry",
         "biomech": "Odd-meter prog ritual temple"}
BANDS = {"Core Battler": (262, 272), "Rare Specialist": (274, 280), "Epic Veteran": (282, 287),
         "Legendary Master": (289, 294), "Mythic Apex (1-of-1)": (297, 300)}
def ren(s):
    for a, b in REN.items(): s = s.replace(a, b)
    return s
def walk(o):
    if isinstance(o, dict): return {k: walk(v) for k, v in o.items()}
    if isinstance(o, list): return [walk(v) for v in o]
    return ren(o) if isinstance(o, str) else o
def dump(p, d):
    with open(p, "w") as f: json.dump(d, f, indent=2, ensure_ascii=False); f.write("\n")

cfg = walk(json.load(open(f"{B}/clan_rarity_config.json")))
cfg["mint_price_sol"] = "TBD"
for k, c in cfg["clans"].items():
    c.pop("inspiration", None); c["theme"] = THEME[k]
    c["tier_power_bands"] = {t: list(v) for t, v in BANDS.items()}
dump(f"{B}/clan_rarity_config.json", cfg)
man = json.load(open(f"{B}/PROJECT_MANIFEST.json"))
def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k != "inspiration"}
    if isinstance(o, list): return [strip(v) for v in o]
    return ren(o) if isinstance(o, str) else o
dump(f"{B}/PROJECT_MANIFEST.json", strip(man))

base = {c["name"]: c["base_stats"] for c in cfg["clans"].values()}
for p in glob.glob(f"{B}/assets/*.json"):
    d = walk(json.load(open(p)))
    at = d["attributes"]
    for a in at:
        if a["trait_type"] == "Blockchain": a["value"] = "Solana"
    A = {a["trait_type"]: a for a in at}
    if "Rarity Tier" in A:
        tid = int(os.path.basename(p)[:-5]); rng = random.Random(8880000 + tid)
        lo, hi = BANDS[A["Rarity Tier"]["value"]]; P = rng.randint(lo, hi)
        bs = base[A["Clan"]["value"]]; s = [bs["atk"], bs["def"], bs["spd"]]
        s = [min(100, x + rng.randint(-3, 3)) for x in s]
        while sum(s) != P:
            i = rng.randrange(3)
            if sum(s) < P and s[i] < 100: s[i] += 1
            elif sum(s) > P and s[i] > 80: s[i] -= 1
        for k, v in zip(("Attack", "Defense", "Speed"), s): A[k]["value"] = str(v)
        A["Power Rating"]["value"] = str(P)
    dump(p, d)
print("done")
