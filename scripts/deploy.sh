#!/usr/bin/env bash
# ==============================================================================
# BeatBots Genesis — Sugar CLI deployment (Candy Machine v3 + Candy Guard)
# Usage (run from the kit's root folder):
#   ./scripts/deploy.sh --devnet     Deploy and test on Solana Devnet
#   ./scripts/deploy.sh --mainnet    Deploy live to Solana Mainnet-Beta
#   ./scripts/deploy.sh --validate   Validate assets only (no transactions)
#
# Optional env vars:
#   RPC_URL=<url>        Use a private RPC instead of the public one (recommended for mainnet)
#   KEYPAIR=<path>       Deployer keypair (default: Solana CLI's configured keypair)
#   SKIP_TEST_MINT=1     Don't mint the 1 test NFT to the deployer
#
# Each network keeps its own cache file (cache-devnet.json / cache-mainnet-beta.json)
# so a mainnet run never reuses devnet's uploads or Candy Machine ID.
# ==============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:---devnet}"
case "$MODE" in
  --mainnet)  NETWORK="mainnet-beta"; DEFAULT_RPC="https://api.mainnet-beta.solana.com" ;;
  --devnet)   NETWORK="devnet";       DEFAULT_RPC="https://api.devnet.solana.com" ;;
  --validate)
    echo "🔍 Pre-flight validation only..."
    python3 scripts/validate_assets.py
    sugar validate
    echo "✅ All assets valid."
    exit 0 ;;
  *) echo "Unknown option: $MODE (use --devnet, --mainnet or --validate)"; exit 1 ;;
esac

RPC_URL="${RPC_URL:-$DEFAULT_RPC}"
CACHE="cache-${NETWORK}.json"
CONFIG="${CONFIG:-config.json}"
SUGAR_ARGS=(--config "$CONFIG" --cache "$CACHE" --rpc-url "$RPC_URL")
SOLANA_ARGS=(--url "$RPC_URL")
if [[ -n "${KEYPAIR:-}" ]]; then
  SUGAR_ARGS+=(--keypair "$KEYPAIR")
  SOLANA_ARGS+=(--keypair "$KEYPAIR")
fi

for bin in solana sugar python3; do
  command -v "$bin" >/dev/null || { echo "❌ $bin not found. See DEPLOYMENT_RUNBOOK.md section 1."; exit 1; }
done

echo "🚀 Target: $NETWORK"
echo "   RPC:    $RPC_URL"
echo "   Cache:  $CACHE"

echo "1. Pre-flight validation (no SOL spent if this fails)..."
python3 scripts/validate_assets.py

echo "2. Deployer wallet..."
DEPLOYER=$(solana address "${SOLANA_ARGS[@]}")
BALANCE=$(solana balance "${SOLANA_ARGS[@]}")
echo "   Address: $DEPLOYER"
echo "   Balance: $BALANCE"

if [[ "$NETWORK" == "mainnet-beta" ]]; then
  echo
  echo "⚠️  MAINNET-BETA: this spends real SOL (Candy Machine rent + Arweave storage)."
  START=$(python3 -c "import json;print(json.load(open('$CONFIG'))['guards']['default'].get('startDate',{}).get('date','none'))")
  echo "   Public mint start date in config.json: $START"
  read -r -p "Type MAINNET to continue: " CONFIRM
  [[ "$CONFIRM" == "MAINNET" ]] || { echo "Aborted."; exit 1; }
fi

echo "3. sugar validate..."
sugar validate

echo "4. Uploading images, audio and metadata to Arweave via Irys (resumable)..."
sugar upload "${SUGAR_ARGS[@]}"

echo "5. Deploying Candy Machine..."
sugar deploy "${SUGAR_ARGS[@]}"

echo "6. Verifying on-chain config lines match the upload..."
sugar verify "${SUGAR_ARGS[@]}"

if [[ "${SKIP_TEST_MINT:-0}" != "1" ]]; then
  echo "7. Test mint of 1 NFT to the deployer (before guards, so the authority can mint)..."
  sugar mint "${SUGAR_ARGS[@]}" --number 1
else
  echo "7. Test mint skipped."
fi

echo "8. Creating the Candy Guard (price, bot tax, mint limit, start date) and wrapping the Candy Machine..."
sugar guard add "${SUGAR_ARGS[@]}"
sugar guard show "${SUGAR_ARGS[@]}"

CM_ID=$(python3 -c "import json;print(json.load(open('$CACHE'))['program'].get('candyMachine',''))")
CG_ID=$(python3 -c "import json;print(json.load(open('$CACHE'))['program'].get('candyGuard',''))")
echo "=============================================================================="
echo "🎉 Deployment complete on $NETWORK"
echo "   Candy Machine ID: $CM_ID"
echo "   Candy Guard ID:   $CG_ID"
echo "   Saved in $CACHE — back this file up; Sugar needs it for future updates/withdraw."
echo "=============================================================================="
