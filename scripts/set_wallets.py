#!/usr/bin/env python3
"""
Replace the creator / treasury wallets everywhere in the kit in one go.

Usage (from the kit's root folder):
  python3 scripts/set_wallets.py --treasury <WALLET> --dao <WALLET> [--treasury-share 85]

Updates: config.json, sugar-config.json, assets/collection.json, assets/0..887.json,
PROJECT_MANIFEST.json, and TREASURY_PUBKEY in index.html.
The treasury wallet also receives mint payments and bot tax.
Run scripts/validate_assets.py afterwards.
"""

import argparse
import glob
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def valid(addr):
    if not addr or any(c not in B58 for c in addr):
        return False
    n = 0
    for c in addr:
        n = n * 58 + B58.index(c)
    lead = len(addr) - len(addr.lstrip("1"))
    return lead + (n.bit_length() + 7) // 8 == 32


def rw(path, fn):
    with open(path) as f:
        data = json.load(f)
    fn(data)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


ap = argparse.ArgumentParser()
ap.add_argument("--treasury", required=True)
ap.add_argument("--dao", required=True)
ap.add_argument("--treasury-share", type=int, default=85)
a = ap.parse_args()

for label, addr in (("treasury", a.treasury), ("dao", a.dao)):
    if not valid(addr):
        sys.exit(f"❌ --{label} {addr!r} is not a valid Solana address")
if a.treasury == a.dao:
    sys.exit("❌ treasury and dao must be different wallets")
if not 0 < a.treasury_share < 100:
    sys.exit("❌ --treasury-share must be between 1 and 99")

creators = [
    {"address": a.treasury, "share": a.treasury_share},
    {"address": a.dao, "share": 100 - a.treasury_share},
]


def fix_config(c):
    c["creators"] = [dict(x) for x in creators]
    for g in c.get("guards", {}).values():
        for guard in ("solPayment", "botTax"):
            if isinstance(g.get(guard), dict) and "destination" in g[guard]:
                g[guard]["destination"] = a.treasury
    c.pop("solPayment", None)


def fix_meta(m):
    m.setdefault("properties", {})["creators"] = [dict(x) for x in creators]


def fix_manifest(m):
    mp = m.get("mint_parameters", {})
    mp["treasury_address"] = a.treasury
    roles = [x.get("role") for x in mp.get("creators", [])] or [None, None]
    mp["creators"] = [
        {**creators[0], "role": roles[0] or "Lead Artist / Treasury"},
        {**creators[1], "role": (roles[1] if len(roles) > 1 else None) or "Community DAO"},
    ]


for name in ("config.json", "sugar-config.json"):
    p = os.path.join(BASE, name)
    if os.path.exists(p):
        rw(p, fix_config)

count = 0
for p in [os.path.join(BASE, "assets", "collection.json")] + glob.glob(os.path.join(BASE, "assets", "[0-9]*.json")):
    rw(p, fix_meta)
    count += 1

rw(os.path.join(BASE, "PROJECT_MANIFEST.json"), fix_manifest)

html = os.path.join(BASE, "site-src", "index.html")
n = 0
if os.path.exists(html):
  with open(html) as f:
    src = f.read()
  src, n = re.subn(r'(const\s+TREASURY_PUBKEY\s*=\s*")[^"]*(")', r"\g<1>" + a.treasury + r"\g<2>", src)
  with open(html, "w") as f:
    f.write(src)

print(f"✅ Wallets set: treasury {a.treasury} ({a.treasury_share}%), DAO {a.dao} ({100 - a.treasury_share}%)")
print(f"   Updated config files, manifest, {count} metadata files, index.html ({n} replacement).")
print("   Next: python3 scripts/validate_assets.py")
