# BeatBots Genesis

888-piece Solana NFT collection (Metaplex Candy Machine v3) and the playbeatbots.com mint site.

## Layout
- `index.html` — the site (deployed to Cloudflare Pages from `dist/`)
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
./scripts/cloudflare_pages_deploy.sh                            # or let Cloudflare build from this repo
```

Wallet addresses currently in the repo are **devnet test wallets**. Run `set_wallets.py` with the real treasury/DAO addresses before mainnet.
Never commit keypairs or `cache-*.json` (see `.gitignore`).
