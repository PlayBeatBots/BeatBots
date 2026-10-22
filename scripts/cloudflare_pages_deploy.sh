#!/usr/bin/env bash
# ==============================================================================
# Cloudflare Pages deployment for playbeatbots.com
# Publishes ONLY the built public site in site/ (index.html + beatbots-mint.js), so
# configs, cache-*.json, scripts and any keypair files are never uploaded.
# ==============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_NAME="playbeatbots"
DOMAIN="playbeatbots.com"
DIST="site"

[[ -f "$DIST/index.html" && -f "$DIST/beatbots-mint.js" ]] || { echo "❌ $DIST/ is not built. Run scripts/build_site.sh first."; exit 1; }

# Safety net: refuse to publish anything that looks like a secret or Sugar cache.
if find "$DIST" \( -name '*.json' -o -name '*keypair*' -o -name '*.pem' -o -name '.env*' \) | grep -q .; then
  echo "❌ dist/ contains JSON/keypair/env files. Refusing to publish."; exit 1
fi

WRANGLER="wrangler"
command -v wrangler >/dev/null || WRANGLER="npx wrangler"

echo "Deploying $DIST/ to Cloudflare Pages project: $PROJECT_NAME..."
$WRANGLER pages deploy "$DIST" --project-name="$PROJECT_NAME" --branch=main --commit-dirty=true

echo "✅ Deployed. First time only: in the Cloudflare dashboard go to"
echo "   Workers & Pages → $PROJECT_NAME → Custom domains, and add $DOMAIN and www.$DOMAIN."
