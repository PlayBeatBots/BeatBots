#!/usr/bin/env python3
"""Trait-matched art plan. Every token's picture = its edition's bot + its Stage Backdrop
+ its Audio Chest Rig gear, lit by its Lighting trait (tier-linked; rarer = flashier).
Writes the 'Lighting' trait into assets/*.json and art/ART_MANIFEST.csv (one row per
image to generate, with filename + full prompt). Deterministic; safe to re-run."""
import csv, glob, json, os
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIGHT = {"Core Battler": ["Stage Lights"], "Rare Specialist": ["Blacklight", "Golden Hour"],
         "Epic Veteran": ["Neon Noir", "Laser Storm"], "Legendary Master": ["Gold Plated"],
         "Mythic Apex (1-of-1)": ["1-of-1"]}
LIGHT_PROMPT = {
 "Stage Lights": "Lighting: the scene's natural stage lighting.",
 "Blacklight": "Lighting: UV blacklight, glowing fluorescent purple and neon accents, dark moody shadows.",
 "Golden Hour": "Lighting: warm golden-hour glow, amber backlight, soft haze and floating dust.",
 "Neon Noir": "Lighting: neon-noir, hard pink and cyan neon edge light, wet reflective floor, deep blacks.",
 "Laser Storm": "Lighting: storm of colored laser beams and strobes slicing through thick haze.",
 "Gold Plated": "The robot's body is fully gold-plated with engraved filigree; radiant gold aura, sparks, epic hero lighting.",
}
EDITION = {  # (clan, edition) -> (art base, bot description)
 ("Intergalactic B-Boys", "V2 SPEAKER-CITY"): ("bboy_0", "boombox-headed b-boy robot in a freeze pose, bandana, chunky sneakers"),
 ("Intergalactic B-Boys", "V1 OG STREET BEANIE"): ("bboy_1", "boombox-headed b-boy robot wearing a knit beanie and bandana, freeze pose"),
 ("Intergalactic B-Boys", "V2 TURNTABLE VARIANT"): ("bboy_2", "boombox-headed b-boy robot in a reflective hazard-stripe vest, freeze pose"),
 ("140 Dub Operators", "V3 COZZA FRENZY STAGE"): ("dub_0", "robot with a wild mane of braided audio cables and a green visor, working a DJ mixer"),
 ("140 Dub Operators", "V2 BASEMENT SYNTH"): ("dub_1", "oscilloscope-headed robot with cable dreadlocks and a speaker chest, playing a synth keyboard"),
 ("Electro-Soul Alchemists", "V2 MODULAR LASER STAGE"): ("alchemist_0", "robot with a geared cassette-deck head in a worn hoodie, holding a vinyl record and a drum pad"),
 ("Electro-Soul Alchemists", "V1 OG WAREHOUSE"): ("alchemist_1", "robot with a geared cassette-deck head in a worn hoodie, holding a vinyl record and a drum pad"),
 ("Industrial Mecha", "V2 STEEL FOUNDRY MECH"): ("industrial_0", "hooded gas-mask robot with turntable shoulders and a glowing amp chest, graffiti gloves"),
 ("Industrial Mecha", "V1 DARK BUNKER EDITION"): ("industrial_1", "hooded gas-mask robot with turntable shoulders and an amp chest, graffiti gloves"),
 ("Polyrhythmic Biomechs", "V2 VISIONARY TEMPLE"): ("biomech_0", "round bronze steampunk drummer robot with goggle eyes, tuning-fork crest and gear-etched armor"),
 ("Polyrhythmic Biomechs", "V1 SUBTERRANEAN TORCHLIT"): ("biomech_1", "round bronze steampunk drummer robot with goggle eyes, tuning-fork crest and gear-etched armor"),
}
cfg = json.load(open(f"{B}/clan_rarity_config.json"))
IDX = {}
for c in cfg["clans"].values():
    for i, v in enumerate(c["stage_backdrop"]): IDX[("b", c["name"], v)] = i + 1
    for i, v in enumerate(c["chest_rig"]): IDX[("r", c["name"], v)] = i + 1
BASE = ("Use the reference image for the robot's design, style and render quality. Square 1:1 highly detailed "
        "3D render, cinematic, gritty texture. No text, letters, logos, brand names or watermarks.")
rows = {}
for p in sorted(glob.glob(f"{B}/assets/[0-9]*.json"), key=lambda s: int(os.path.basename(s)[:-5])):
    d = json.load(open(p)); tid = int(os.path.basename(p)[:-5])
    at = [a for a in d["attributes"] if a["trait_type"] not in ("Finish", "Lighting")]
    a = {x["trait_type"]: x["value"] for x in at}
    opts = LIGHT[a["Rarity Tier"]]; light = opts[tid % len(opts)]
    at.insert(next(k for k, x in enumerate(at) if x["trait_type"] == "Stage Backdrop") + 1,
              {"trait_type": "Lighting", "value": light})
    d["attributes"] = at
    with open(p, "w") as fh: json.dump(d, fh, indent=2, ensure_ascii=False); fh.write("\n")
    if light == "1-of-1": continue
    base, bot = EDITION[(a["Clan"], a["Visual Edition"])]
    b, r = IDX[("b", a["Clan"], a["Stage Backdrop"])], IDX[("r", a["Clan"], a["Audio Chest Rig"])]
    name = f"{base}-b{b}-r{r}" + ("" if light == "Stage Lights" else "-" + light.lower().replace(" ", "_")) + ".jpg"
    row = rows.setdefault(name, {"file": name, "reference": f"{base}.jpg", "tier_lighting": light, "bots": 0,
        "prompt": f"{bot}. Built into / carrying: {a['Audio Chest Rig']}. Setting: {a['Stage Backdrop']}. "
                  f"{LIGHT_PROMPT[light]} {BASE}"})
    row["bots"] += 1
PHASE = {"Stage Lights": 1, "Gold Plated": 2, "Neon Noir": 3, "Laser Storm": 3, "Blacklight": 4, "Golden Hour": 4}
out = sorted(rows.values(), key=lambda r: (PHASE[r["tier_lighting"]], r["file"]))
with open(f"{B}/art/ART_MANIFEST.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, ["phase", "file", "reference", "tier_lighting", "bots", "prompt"]); w.writeheader()
    for r in out: w.writerow({"phase": PHASE[r["tier_lighting"]], **r})
print(len(out), "images in art/ART_MANIFEST.csv")
