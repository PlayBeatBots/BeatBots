#!/usr/bin/env python3
"""
Build the assets/ folder using shared clan-edition artwork (Option 1).

Each token gets a copy of the artwork for its Clan + Visual Edition, saved as N.jpg,
and its metadata is updated to point at it. Audio (.mp3) references are removed for now.
A collection image (collection.jpg) is generated as a mosaic of the clan artworks.

Usage (from the kit's root folder):
  python3 scripts/build_clan_assets.py <folder-with-edition-art>

The art folder must contain the files listed in EDITION_ART below.
Re-runnable: it rewrites N.jpg and the image fields every time.
"""

import glob
import json
import os
import shutil
import sys

from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(BASE, "assets")
SUPPLY = 888

# (Clan, Visual Edition) -> artwork file
EDITION_ART = {
    ("Intergalactic B-Boys", "V2 SPEAKER-CITY"): "bboy_0.jpg",
    ("Intergalactic B-Boys", "V1 OG STREET BEANIE"): "bboy_1.jpg",
    ("Intergalactic B-Boys", "V2 TURNTABLE VARIANT"): "bboy_2.jpg",
    ("140 Dub Operators", "V3 COZZA FRENZY STAGE"): "dub_0.jpg",
    ("140 Dub Operators", "V2 BASEMENT SYNTH"): "dub_1.jpg",
    ("Electro-Soul Alchemists", "V2 MODULAR LASER STAGE"): "alchemist_0.jpg",
    ("Electro-Soul Alchemists", "V1 OG WAREHOUSE"): "alchemist_1.jpg",
    ("Industrial Mecha", "V2 STEEL FOUNDRY MECH"): "industrial_0.jpg",
    ("Industrial Mecha", "V1 DARK BUNKER EDITION"): "industrial_1.jpg",
    ("Polyrhythmic Biomechs", "V2 VISIONARY TEMPLE"): "biomech_0.jpg",
    ("Polyrhythmic Biomechs", "V1 SUBTERRANEAN TORCHLIT"): "biomech_1.jpg",
}
# Collection display: Cozza Frenzy as the large hero, other editions sprinkled around it
COLLECTION_HERO = "dub_0.jpg"  # 140 Dub Operators — V3 Cozza Frenzy Stage
COLLECTION_TILES = ["bboy_0.jpg", "alchemist_0.jpg", "industrial_0.jpg", "biomech_0.jpg", "bboy_2.jpg"]


CLAN_KEY = {"Intergalactic B-Boys": "bboy", "140 Dub Operators": "dub", "Electro-Soul Alchemists": "alchemist",
            "Industrial Mecha": "industrial", "Polyrhythmic Biomechs": "biomech"}
_CFG = json.load(open(os.path.join(BASE, "clan_rarity_config.json")))["clans"]
_IDX = {}
for _c in _CFG.values():
    for _i, _v in enumerate(_c["stage_backdrop"]): _IDX[("b", _c["name"], _v)] = _i + 1
    for _i, _v in enumerate(_c["chest_rig"]): _IDX[("r", _c["name"], _v)] = _i + 1


def variant_art(art, base_file, attrs):
    """Most specific art that exists: lit scene -> scene -> None (caller uses edition base).
    Filenames match art/ART_MANIFEST.csv (tools/art_manifest.py)."""
    light = attrs.get("Lighting", "Stage Lights")
    if light == "1-of-1":
        p = os.path.join(art, f"mythic_{CLAN_KEY[attrs['Clan']]}.jpg")
        return p if os.path.exists(p) else None
    scene = (f"{base_file[:-4]}-b{_IDX[('b', attrs['Clan'], attrs['Stage Backdrop'])]}"
             f"-r{_IDX[('r', attrs['Clan'], attrs['Audio Chest Rig'])]}")
    tries = ([scene + "-" + light.lower().replace(" ", "_")] if light != "Stage Lights" else []) + [scene]
    for t in tries:
        p = os.path.join(art, t + ".jpg")
        if os.path.exists(p):
            return p
    return None


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    art = sys.argv[1]
    missing = sorted({f for f in EDITION_ART.values() if not os.path.exists(os.path.join(art, f))})
    if missing:
        sys.exit(f"❌ Missing artwork in {art}: {missing}")

    # Remove stale media from earlier runs
    for pattern in ("[0-9]*.png", "[0-9]*.jpg", "[0-9]*.mp3", "collection.png", "collection.jpg"):
        for f in glob.glob(os.path.join(ASSETS, pattern)):
            os.remove(f)

    counts = {}
    fallback = 0
    for i in range(SUPPLY):
        path = os.path.join(ASSETS, f"{i}.json")
        with open(path) as f:
            meta = json.load(f)
        attrs = {a["trait_type"]: a["value"] for a in meta["attributes"]}
        key = (attrs["Clan"], attrs["Visual Edition"])
        if key not in EDITION_ART:
            sys.exit(f"❌ {i}.json has no artwork mapped for {key}")
        src = variant_art(art, EDITION_ART[key], attrs)
        if src is None:
            src = os.path.join(art, EDITION_ART[key]); fallback += 1
        shutil.copyfile(src, os.path.join(ASSETS, f"{i}.jpg"))
        counts[key] = counts.get(key, 0) + 1

        meta["image"] = f"{i}.jpg"
        meta.pop("animation_url", None)
        props = meta.setdefault("properties", {})
        props["files"] = [{"uri": f"{i}.jpg", "type": "image/jpeg"}]
        props["category"] = "image"
        with open(path, "w") as f:
            json.dump(meta, f, indent=2)
            f.write("\n")

    # Collection image, 1200x1200: hero fills the top-left 2x2 of a 3x3 grid,
    # the other editions fill the right column and bottom row.
    size, tile = 1200, 400
    mosaic = Image.new("RGB", (size, size))
    hero = Image.open(os.path.join(art, COLLECTION_HERO)).convert("RGB").resize((tile * 2, tile * 2), Image.LANCZOS)
    mosaic.paste(hero, (0, 0))
    slots = [(2, 0), (2, 1), (0, 2), (1, 2), (2, 2)]
    for (cx, cy), name in zip(slots, COLLECTION_TILES):
        im = Image.open(os.path.join(art, name)).convert("RGB").resize((tile, tile), Image.LANCZOS)
        mosaic.paste(im, (cx * tile, cy * tile))
    mosaic.save(os.path.join(ASSETS, "collection.jpg"), quality=90)

    col_path = os.path.join(ASSETS, "collection.json")
    with open(col_path) as f:
        col = json.load(f)
    col["image"] = "collection.jpg"
    col.setdefault("properties", {})["files"] = [{"uri": "collection.jpg", "type": "image/jpeg"}]
    col["properties"]["category"] = "image"
    with open(col_path, "w") as f:
        json.dump(col, f, indent=2)
        f.write("\n")

    total = sum(os.path.getsize(os.path.join(ASSETS, f"{i}.jpg")) for i in range(SUPPLY))
    if fallback:
        print(f"ℹ️  {fallback} tokens used base edition art (variant art not in {art} yet)")
    print(f"✅ Built {SUPPLY} token images + collection.jpg ({total / 1e6:.0f} MB of images)")
    for (clan, ed), n in sorted(counts.items()):
        print(f"  {n:4d}  {clan} / {ed}")


if __name__ == "__main__":
    main()
