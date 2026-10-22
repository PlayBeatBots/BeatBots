# BEATBOTS GENESIS — TECHNICAL DEPLOYMENT RUNBOOK

This runbook contains technical procedures, exact commands, error-handling routines, and recovery operations for deploying the BeatBots 888 Genesis Collection on Solana.

---

## 1. System Requirements & CLI Installation

### Solana CLI
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version
```

### Sugar CLI (Metaplex)
```bash
bash <(curl -sSf https://sugar.metaplex.com/install.sh)
export PATH="$HOME/.cargo/bin:$PATH"
sugar --version
```

### Node.js & Wrangler (for Cloudflare Pages)
```bash
node -v
npm -v
npm install -g wrangler
```

---

## 2. Wallet & Keypair Setup

Ensure your deployer keypair is configured:
```bash
# Check current keypair
solana address

# Check balance
solana balance --url https://api.mainnet-beta.solana.com
```

**Required Balance Budget:**
- Candy Machine Account Rent: ~1.48 SOL (100% refundable upon `sugar withdraw`)
- Irys Decentralized Storage: ~0.08 SOL (permanent Arweave storage)
- Collection Parent NFT & PDA Rent: ~0.02 SOL
- Network Gas & Guard Fees: ~0.02 SOL
- **Recommended Wallet Minimum**: `1.80 SOL`

---

## 3. Pre-Flight Asset & Schema Validation

Before submitting any transactions, run the local validation suite:
```bash
python3 scripts/validate_assets.py
```
This performs:
1. Strict JSON Schema validation on all 888 tokens (`0.json` - `887.json`) and `collection.json`.
2. Verification of required fields: `name`, `symbol`, `description`, `seller_fee_basis_points`, `image`, `attributes`, `properties.creators`, and `properties.files`.
3. Clan allocation audit verifying:
   - Intergalactic B-Boys: 210
   - 140 Dub Operators: 195
   - Electro-Soul Alchemists: 175
   - Industrial Mecha: 165
   - Polyrhythmic Biomechs: 143
   - Total: exactly 888 items.
4. Domain verification (`https://playbeatbots.com`).

---

## 4. Sugar CLI Deployment Commands

### Phase 1: Validate
```bash
sugar validate
```
*Pass Criteria:* Output displays `Validation successful! All 888 items and collection asset are valid.`

### Phase 2: Upload to Irys / Arweave
```bash
sugar upload
```
*Note on Network Interruptions:* Sugar tracks uploaded assets in `cache.json`. If an upload connection times out, simply rerun `sugar upload`. It automatically resumes from the last completed asset index without re-uploading or double-charging.

### Phase 3: Deploy Candy Machine v3 Account
```bash
sugar deploy
```
*Expected Output:*
```text
Candy Machine ID: <CANDY_MACHINE_PUBKEY>
Candy Guard ID:   <CANDY_GUARD_PUBKEY>
```
Record both public keys.

### Phase 4: Verify On-Chain State
```bash
sugar verify
```
Confirms on-chain ledger matches local assets.

### Phase 5: Test Mint
```bash
sugar mint
```
Mints 1 token directly to the deployer keypair to verify metadata resolution and reveal.

---

## 5. Cloudflare Pages Deployment (`playbeatbots.com`)

### Method A: Wrangler CLI (Fastest)
```bash
cd /path/to/agent_ops
wrangler pages deploy . --project-name=playbeatbots --commit-dirty=true
```

### Method B: Cloudflare Dashboard
1. Log into Cloudflare Dashboard -> **Workers & Pages**.
2. Click **Create application** -> **Pages** -> **Upload assets**.
3. Project Name: `playbeatbots`.
4. Upload `index.html`.
5. Under **Custom Domains**, add `playbeatbots.com` and `www.playbeatbots.com`.
6. Confirm DNS activation.

---

## 6. Troubleshooting & Recovery Routines

### Issue: "Not enough SOL for rent"
*Symptom:* `sugar deploy` fails stating account cannot be initialized.
*Fix:* Transfer at least 1.8 SOL into the deployer wallet address. Remember ~1.5 SOL will be refunded later.

### Issue: "Upload stalled at index X"
*Symptom:* Network timeout during Arweave upload.
*Fix:* Check internet connectivity, then run `sugar upload` again. Sugar's cache prevents re-uploading completed files.

### Emergency Command: Reclaim Rent
If a deployment fails or must be aborted before public mint:
```bash
sugar withdraw
```
This immediately closes the Candy Machine account on Solana and returns all ~1.48 SOL back to the deployer wallet.
