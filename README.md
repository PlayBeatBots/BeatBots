# BeatBots Genesis

888-piece Solana NFT collection (Metaplex Candy Machine v3) and the playbeatbots.com mint site.

## Layout
- `site/` — **the deployed website** (Cloudflare Pages output folder): `index.html` + `beatbots-mint.js`
- `site-src/index.html` — page template; `tools/patch_site.py` turns it into `site/index.html`
- `mint-client/` — source of the real Candy Machine mint (`beatbots-mint.js`, built with esbuild)
- `site-src/beatbots-audio.js` — audio engine v4 (procedural drums, clan voicings, UI sounds, WAV export); copied to `site/`
- `assets/` — 888 token metadata files + `collection.json` (images are generated, not committed)
- `art/` — the 12 clan-edition artworks used to generate token images
- `config.json` — Sugar config for **mainnet** (start date Nov 1); `config-devnet.json` for devnet testing
- `scripts/` — build, validate, wallet setup, deploy

## Workflow
```bash
pip install jsonschema pillow
python3 scripts/build_clan_assets.py art                       # generate 888 images + collection.jpg
python3 scripts/set_wallets.py --treasury <WALLET> --dao <WALLET>
python3 scripts/validate_assets.py                              # pre-flight
CONFIG=config-devnet.json KEYPAIR=<path> ./scripts/deploy.sh --devnet
./scripts/build_site.sh devnet https://api.devnet.solana.com <CANDY_MACHINE_ID>   # rebuild site/
# Cloudflare Pages deploys site/ automatically on every push to main
```

Wallet addresses currently in the repo are **devnet test wallets**. Run `set_wallets.py` with the real treasury/DAO addresses before mainnet.
Never commit keypairs or `cache-*.json` (see `.gitignore`).

## Current devnet deployment
- Candy Machine: `FCrJhgeHCdZyAbTPAjG6TgC3f9XeqMucoZ1mQHjbemPo`
- Candy Guard: `DApNAvBE9hgEmeJpTSJVB9v91xnU59RshHBnfK8E44Qa`
- Collection: `GzGaVXPwRxMn3D89NsdwUPTHAFUyjyUyv1AtkqJmNJzf`
- Guards: 0.5 SOL, 0.01 SOL bot tax, 5 per wallet

## Before mainnet
- `set_wallets.py` with the real treasury/DAO wallets
- `config.json` start date (currently 2026-11-01)
- A private mainnet RPC URL for the site (the public mainnet RPC rate-limits browsers)
- `build_site.sh mainnet-beta <RPC> <MAINNET_CM_ID>` after the mainnet deploy

## Testing
- `node tools/audio_test.cjs site <outDir>` — fires every voice/FX/UI sound headlessly, measures levels, renders clan demo loops
- `node tools/browser_e2e.cjs site <devnet-keypair.json> <qty> <shotDir>` — real devnet mint through the UI (`SITE_URL=` to test the live site)
