# PROMPT FOR CLAUDE: BEATBOTS 888 GENESIS DEPLOYMENT

> **INSTRUCTION FOR CLAUDE**: You are acting as the Autonomous Solana Web3 DevOps Lead for **BeatBots** (888 Genesis NFT Collection). All assets, schemas, rarity models, Sugar CLI configs, and the dApp frontend have already been built, verified, and organized in this `agent_ops/` package. Your objective is to execute the deployment pipeline flawlessly.

---

## 1. Context & Mission Parameters

* **Collection Name**: BeatBots Genesis (`BEAT`)
* **Total Supply**: Exactly 888 Non-Fungible Tokens across 5 Sound Clans
* **Program Standard**: Metaplex Non-Fungible Token Standard & Candy Machine v3 (CMv3)
* **Live Domain**: `https://playbeatbots.com` (Registered and DNS-managed on Cloudflare)
* **Frontend Hosting**: Cloudflare Pages (`playbeatbots`)
* **Mint Price**: 0.50 SOL per BeatBot (Max 5 per wallet limit, 0.01 SOL bot tax)
* **Creator Royalties**: 500 bps (5.00%)
  * Lead Artist / TecSuport Treasury (85%): `7xKpX4d5nQe4m9B2vR8sC1pL3wT6yF8uJ0aZ5vW9kQ2e`
  * Community DAO (15%): `BEATdaoTreasury11111111111111111111111111111`
* **Decentralized Storage**: Irys / Arweave (`uploadMethod: "irys"`)

---

## 2. Directory Layout in this Workspace

```text
agent_ops/
├── PROJECT_MANIFEST.json        # Machine-readable specifications & constants
├── CLAUDE_DEPLOYMENT_PROMPT.md  # (This instruction file)
├── DEPLOYMENT_RUNBOOK.md        # Comprehensive technical execution manual
├── config.json                  # Sugar CMv3 configuration
├── sugar-config.json            # Backup copy of configuration
├── metaplex-metadata-schema.json# JSON Schema validation spec
├── clan_rarity_config.json      # Clan & trait mathematical distribution
├── index.html                   # Live frontend dApp (Web3 wallet adapter + 16-step sequencer + WAV export)
├── scripts/
│   ├── deploy.sh                # Automated Sugar CLI deployment script
│   ├── validate_assets.py       # Python script validating all 888 metadata files
│   └── cloudflare_pages_deploy.sh # Cloudflare Pages deployment script
└── assets/
    ├── collection.json          # Master on-chain collection metadata
    ├── 0.json ... 887.json      # 888 pre-generated & validated Metaplex token metadata files
    └── [image files]            # Paired artwork files (0.png through 887.png)
```

---

## 3. Step-by-Step Execution Plan for Claude

### Step 1: Pre-Flight Integrity Check
Run the validation script to verify that all 888 JSON files conform strictly to the Metaplex standard schema:
```bash
python3 scripts/validate_assets.py
```
Ensure output reports 888 valid items, zero schema violations, and correct `https://playbeatbots.com` URLs.

### Step 2: Environment & Wallet Verification
1. Verify `solana` CLI and `sugar` CLI:
   ```bash
   solana --version
   sugar --version
   ```
2. Verify deployer keypair balance (needs ~1.8 SOL for on-chain CM account rent and Irys upload):
   ```bash
   solana balance
   ```

### Step 3: Devnet Dry-Run (Recommended First)
Deploy to Solana Devnet first to verify upload, minting, and frontend integration:
```bash
./scripts/deploy.sh --devnet
```
This runs:
1. `sugar validate`
2. `sugar upload` (uploads assets to Arweave devnet)
3. `sugar deploy` (deploys CMv3 program account)
4. `sugar verify`
5. `sugar mint` (mints 1 test token to deployer wallet)

Record the generated `Candy Machine ID` and `Candy Guard ID`.

### Step 4: Mainnet-Beta Deployment
Once Devnet confirms cleanly:
```bash
./scripts/deploy.sh --mainnet
```
Note the on-chain Candy Machine ID.

### Step 5: Cloudflare Pages Frontend Deployment
Deploy `index.html` to Cloudflare Pages for `playbeatbots.com`:
```bash
./scripts/cloudflare_pages_deploy.sh
```
Or via Wrangler:
```bash
npx wrangler pages deploy . --project-name=playbeatbots --branch=main
```
Verify `https://playbeatbots.com` is live and that wallet connection and mint modals function properly.

---

## 4. Post-Deployment Verification Checklist

- [ ] All 888 assets uploaded to Irys without missing indices.
- [ ] On-chain Candy Machine initialized with 0.50 SOL payment guard and 5-bot limit.
- [ ] Collection NFT minted and verified as the Metaplex Collection parent.
- [ ] `index.html` live on `https://playbeatbots.com` with active SSL.
- [ ] Test transaction initiates cleanly through Phantom / Solflare / Backpack.
- [ ] Treasury wallet confirmed as recipient of 85% mint proceeds.
