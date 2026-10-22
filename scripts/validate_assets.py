#!/usr/bin/env python3
"""
Pre-Flight Asset & Schema Validator for BeatBots 888 Genesis.

Checks, in order:
  1. collection.json exists, has the right external_url, and its image file is present
  2. Exactly 888 token files, indexed 0..887 with no gaps
  3. Every token passes the Metaplex JSON schema
  4. Every file a token references (image, animation_url, properties.files) exists in assets/
  5. Creator wallets are real Solana addresses (not placeholders), identical everywhere,
     shares add to 100, and royalties match config.json
  6. Clan and rarity counts match PROJECT_MANIFEST.json

Exits non-zero on any failure, so deploy.sh stops before spending SOL.
"""

import glob
import json
import os
import sys

import jsonschema

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(BASE_DIR, "metaplex-metadata-schema.json")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
MANIFEST_PATH = os.path.join(BASE_DIR, "PROJECT_MANIFEST.json")
DOMAIN = "https://playbeatbots.com"
SUPPLY = 888

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
KNOWN_PLACEHOLDERS = {
    "7xKpX4d5nQe4m9B2vR8sC1pL3wT6yF8uJ0aZ5vW9kQ2e",
    "BEATdaoTreasury11111111111111111111111111111",
}

errors = []


def fail(msg):
    errors.append(msg)


def load(path):
    with open(path) as f:
        return json.load(f)


def address_problem(addr):
    """Return a reason string if addr is not a usable Solana wallet, else None."""
    if addr in KNOWN_PLACEHOLDERS:
        return "placeholder address from the kit; replace with your real wallet"
    bad = [c for c in addr if c not in B58]
    if bad:
        return f"not valid base58 (contains {''.join(sorted(set(bad)))})"
    n = 0
    for c in addr:
        n = n * 58 + B58.index(c)
    lead = len(addr) - len(addr.lstrip("1"))
    if lead + (n.bit_length() + 7) // 8 != 32:
        return "does not decode to a 32-byte public key"
    if "1111111111" in addr:
        return "vanity/burn-style address; nobody holds its private key"
    return None


def referenced_files(meta):
    files = set()
    for key in ("image", "animation_url"):
        v = meta.get(key)
        if v and not v.startswith(("http://", "https://", "ar://")):
            files.add(v)
    for f in meta.get("properties", {}).get("files", []):
        uri = f.get("uri", "")
        if uri and not uri.startswith(("http://", "https://", "ar://")):
            files.add(uri)
    return files


def check_creators(creators, where):
    if not creators:
        fail(f"{where}: no creators listed")
        return
    total = sum(c.get("share", 0) for c in creators)
    if total != 100:
        fail(f"{where}: creator shares add to {total}, must be 100")


schema = load(SCHEMA_PATH)
config = load(CONFIG_PATH)
manifest = load(MANIFEST_PATH)
print(f"Loaded schema, config and manifest from {BASE_DIR}")

# ---- Wallets in config.json ------------------------------------------------
config_creators = config.get("creators", [])
check_creators(config_creators, "config.json")
wallets = {c["address"] for c in config_creators}
for g in config.get("guards", {}).values():
    for guard in ("solPayment", "botTax"):
        dest = (g.get(guard) or {}).get("destination")
        if dest:
            wallets.add(dest)
for w in sorted(wallets):
    reason = address_problem(w)
    if reason:
        fail(f"wallet {w}: {reason}")
config_creators_key = json.dumps(sorted(config_creators, key=lambda c: c["address"]), sort_keys=True)
sfbp = config.get("sellerFeeBasisPoints")

# ---- collection.json -------------------------------------------------------
col_path = os.path.join(ASSETS_DIR, "collection.json")
if not os.path.exists(col_path):
    fail("assets/collection.json is missing")
else:
    col = load(col_path)
    if col.get("external_url") != DOMAIN:
        fail(f"collection.json external_url is {col.get('external_url')!r}")
    for ref in referenced_files(col):
        if not os.path.exists(os.path.join(ASSETS_DIR, ref)):
            fail(f"collection.json references {ref}, which is not in assets/")
    print("Checked collection.json")

# ---- Token files -----------------------------------------------------------
token_files = glob.glob(os.path.join(ASSETS_DIR, "[0-9]*.json"))
if len(token_files) != SUPPLY:
    fail(f"expected {SUPPLY} token files, found {len(token_files)}")
gaps = [i for i in range(SUPPLY) if not os.path.exists(os.path.join(ASSETS_DIR, f"{i}.json"))]
if gaps:
    fail(f"token indices missing (Sugar needs 0..{SUPPLY - 1} with no gaps): {gaps[:10]}{'...' if len(gaps) > 10 else ''}")

clans, tiers = {}, {}
schema_errors = 0
missing_media = {}
creator_mismatch = 0
sfbp_mismatch = 0
names = {}

for i in range(SUPPLY):
    tf = os.path.join(ASSETS_DIR, f"{i}.json")
    if not os.path.exists(tf):
        continue
    data = load(tf)
    try:
        jsonschema.validate(instance=data, schema=schema)
    except jsonschema.ValidationError as err:
        schema_errors += 1
        if schema_errors <= 5:
            fail(f"{i}.json schema: {err.message}")
    if data.get("external_url") != DOMAIN:
        fail(f"{i}.json external_url is {data.get('external_url')!r}")
    for ref in referenced_files(data):
        if not os.path.exists(os.path.join(ASSETS_DIR, ref)):
            ext = os.path.splitext(ref)[1] or "(no extension)"
            missing_media[ext] = missing_media.get(ext, 0) + 1
    tc = data.get("properties", {}).get("creators", [])
    if json.dumps(sorted(tc, key=lambda c: c["address"]), sort_keys=True) != config_creators_key:
        creator_mismatch += 1
    if data.get("seller_fee_basis_points") != sfbp:
        sfbp_mismatch += 1
    if len(str(data.get("name", "")).encode()) > 32:
        fail(f"{i}.json: name is over Solana's 32-byte limit: {data.get('name')!r}")
    nonstr = [a.get("trait_type") for a in data.get("attributes", []) if not isinstance(a.get("value"), str)]
    if nonstr:
        fail(f"{i}.json: attribute values must be strings for Sugar (fix: {', '.join(map(str, nonstr[:4]))})")
    names[data.get("name")] = names.get(data.get("name"), 0) + 1
    attrs = {a["trait_type"]: a["value"] for a in data.get("attributes", [])}
    clans[attrs.get("Clan", "Unknown")] = clans.get(attrs.get("Clan", "Unknown"), 0) + 1
    tiers[attrs.get("Rarity Tier", "Unknown")] = tiers.get(attrs.get("Rarity Tier", "Unknown"), 0) + 1

if schema_errors > 5:
    fail(f"...and {schema_errors - 5} more schema errors")
for ext, n in sorted(missing_media.items()):
    fail(f"{n} token(s) reference {ext} files that are not in assets/ (Sugar upload will fail)")
if creator_mismatch:
    fail(f"{creator_mismatch} token(s) have creators that differ from config.json")
if sfbp_mismatch:
    fail(f"{sfbp_mismatch} token(s) have seller_fee_basis_points different from config.json ({sfbp})")
dupes = [n for n, c in names.items() if c > 1]
if dupes:
    fail(f"{len(dupes)} duplicate token names, e.g. {dupes[0]!r}")

# ---- Counts vs manifest ----------------------------------------------------
want_clans = {k: v["count"] for k, v in manifest.get("clans_allocation", {}).items()}
if want_clans and clans != want_clans:
    fail(f"clan counts {clans} do not match manifest {want_clans}")
want_tiers = manifest.get("rarity_tiers", {})
if want_tiers and tiers != want_tiers:
    fail(f"rarity counts {tiers} do not match manifest {want_tiers}")

print("\nClan breakdown:")
for c, n in sorted(clans.items()):
    print(f"  - {c}: {n}")
print("\nRarity breakdown:")
for t, n in sorted(tiers.items(), key=lambda x: -x[1]):
    print(f"  - {t}: {n}")

if errors:
    print(f"\n❌ PRE-FLIGHT FAILED ({len(errors)} problem(s)):")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

print(f"\n✅ Pre-flight passed: {SUPPLY} tokens + collection, all media present, wallets valid.")
