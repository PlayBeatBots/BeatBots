#!/usr/bin/env python3
"""Adds a 'Finish' trait to every token, tied to its tier (rarer tier = rarer finish).
Art variants live in art/ as <base>_<finish-slug>.jpg (e.g. dub_0_midnight.jpg);
Mythics use art/mythic_<clankey>.jpg. build_clan_assets.py falls back to the base
edition art when a variant file isn't there yet. Deterministic; safe to re-run."""
import json, glob, os, random
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINISH = {
 "Core Battler": ["Factory", "Midnight", "Toxic", "Sunset"],
 "Rare Specialist": ["Ice", "Crimson"],
 "Epic Veteran": ["Chrome", "Neon Trim"],
 "Legendary Master": ["Gold Plated"],
 "Mythic Apex (1-of-1)": ["1-of-1"],
}
for p in sorted(glob.glob(f"{B}/assets/[0-9]*.json")):
    d = json.load(open(p)); tid = int(os.path.basename(p)[:-5])
    at = [a for a in d["attributes"] if a["trait_type"] != "Finish"]
    tier = next(a["value"] for a in at if a["trait_type"] == "Rarity Tier")
    opts = FINISH[tier]; f = opts[tid % len(opts)] if len(opts) > 1 else opts[0]
    i = next(k for k, a in enumerate(at) if a["trait_type"] == "Visual Edition")
    at.insert(i + 1, {"trait_type": "Finish", "value": f})
    d["attributes"] = at
    with open(p, "w") as fh: json.dump(d, fh, indent=2, ensure_ascii=False); fh.write("\n")
print("Finish trait set on all tokens")
