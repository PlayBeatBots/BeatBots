#!/usr/bin/env bash
# Build the deployable site/ folder: bundle the mint client and patch the page.
# Usage: scripts/build_site.sh <network> <rpc-url> <candy-machine-id>
#   devnet:  scripts/build_site.sh devnet https://api.devnet.solana.com <CM_ID>
#   mainnet: scripts/build_site.sh mainnet-beta <PRIVATE_RPC_URL> <CM_ID>
set -euo pipefail
cd "$(dirname "$0")/.."
NETWORK="${1:?network}"; RPC="${2:?rpc url}"; CM="${3:?candy machine id}"
(cd mint-client && npm ci --silent && npx esbuild src/mint.js --bundle --minify --format=iife \
  --platform=browser --target=es2020 --define:global=window --outfile=../site/beatbots-mint.js)
python3 tools/patch_site.py site-src/index.html site/index.html "$NETWORK" "$RPC" "$CM"
python3 tools/split_pages.py site/index.html site   # home / studio / mint pages from the one source
cp site-src/battle.html site/battle.html
cp site-src/beatbots-clans.js site/beatbots-clans.js
cp site-src/beatbots-audio.js site/beatbots-audio.js
cp site-src/beatbots-padbattle.js site/beatbots-padbattle.js
rm -f site/beatbots-rhythm.js
cp site-src/command-center.css site/command-center.css
cp site-src/command-center.js site/command-center.js
rm -rf site/kits && cp -r site-src/kits site/kits
rm -rf site/img && cp -r site-src/img site/img
cp site-src/_headers site/_headers
cp site-src/robots.txt site/robots.txt
cp site-src/sitemap.xml site/sitemap.xml
echo "✅ site/ built for $NETWORK (Candy Machine $CM)"
