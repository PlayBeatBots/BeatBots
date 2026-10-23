# BEATBOTS GENESIS — OPS RUNBOOK (shared source of truth)

Owner: Jake. Maintained by Claude (code, deploys, fixes). Gemini owns UI/design.
Repo copy: `DEPLOYMENT_RUNBOOK.md` in github.com/PlayBeatBots/BeatBots. Drive copy: Agent Ops - Claude Deployment / DEPLOYMENT_RUNBOOK.md. Both hold the same text; the repo copy wins if they disagree.
checked_at: 2026-10-23T16:45Z (Claude)

## 0. Rules for every agent
1. Read this file before touching the repo, the site, the Candy Machine or the kits.
2. After any change, add a dated line to the CHANGE LOG (section 10): what changed, commit hash, how it was verified.
3. Never store secrets here or in the repo: no keypairs, seed phrases, API keys, RPC keys. Public addresses and URLs are fine.
4. All wallet addresses in the Drive folder are PLACEHOLDERS until Jake supplies the real Tec5uport/DAO wallets before mainnet.
5. UI/design changes (Gemini) go in `site-src/index.html`; run `scripts/build_site.sh` afterwards — never hand-edit `site/`.
6. Mark guesses as "(unverified)".
7. MUSIC POLICY (Jake, 2026-10-23): the public site uses only original TecSuport clan tribute tracks with lore titles (e.g. Brooklyn Cypher, 20 Double-Bins). No copyrighted masters and no trademarked artist names are hosted on Cloudflare. Raw samples served in kits/ must be licensed for redistribution, not just for use in songs.

## 1. Current state
| Item | Value |
|---|---|
| Network | Solana DEVNET only. Mainnet not deployed. |
| Candy Machine | FCrJhgeHCdZyAbTPAjG6TgC3f9XeqMucoZ1mQHjbemPo |
| Candy Guard | DApNAvBE9hgEmeJpTSJVB9v91xnU59RshHBnfK8E44Qa |
| Collection NFT | GzGaVXPwRxMn3D89NsdwUPTHAFUyjyUyv1AtkqJmNJzf |
| Guards | solPayment 0.5 SOL, botTax 0.01, mintLimit 5 per wallet, startDate |
| Minted (devnet) | ~11 / 888 (test mints) |
| Site | https://playbeatbots.pages.dev (live). playbeatbots.com custom domain NOT attached yet. |
| Hosting | Cloudflare Pages, Git-connected to PlayBeatBots/BeatBots (branch main), output dir `site/`. Every push to main redeploys. |
| Art model | Option 1: shared clan-edition art; Cozza Frenzy is the main display image. "Inspiration" trait removed; each theme is nodded to in copy/traits. |
| Mainnet config | `config.json` (start date Nov 1) — wallets are placeholders. |

## 2. Repo layout
- `assets/` 0..887 .json/.png + collection — Metaplex metadata (attribute values are strings; names <= 32 bytes, long Mythic names kept in a "Mythic Title" trait).
- `config.json` (mainnet), `config-devnet.json` — Sugar 2.9 schema (uploadMethod "bundlr").
- `mint-client/src/mint.js` — Umi mintV2 module: init, getStats, walletMinted, mint, explorerTx, explorerAddress. Pre-flight checks supply, start/end date, mint-limit counter and balance (price + 0.025 SOL/NFT) BEFORE sending, and verifies the NFT account exists after — so a guard rejection can no longer show "MINTED".
- `site-src/index.html` — page template (Gemini edits here).
- `site-src/beatbots-audio.js` — audio engine v4 (`BBAudio.createEngine(ctx)`).
- `site-src/beatbots-rhythm.js` — rhythm battle (`BBRhythm`).
- `site-src/kits/<clan>/` — per-clan WAV kits + kit.json + LICENSE.txt (bboy, dub, alchemist, industrial, biomech).
- `site/` — BUILT output, published by Cloudflare. Generated; do not hand-edit.
- `scripts/` — build_site.sh, deploy.sh, set_wallets.py, validate_assets.py, build_clan_assets.py, cloudflare_pages_deploy.sh (legacy Wrangler path, not used).
- `tools/` — patch_site.py, build_kits.py, kit_gains.json, drive_kits.json, integrate_*.py (one-time), tests (*.cjs).
- NEVER committed: keypairs, `cache-*.json`, `.env`.

## 3. Tooling
- Solana CLI (Anza stable) and Sugar 2.9.1. Sugar needs a Solana config file: `solana config set --url <rpc> --keypair <path>` (deploy.sh creates it if missing).
- Node 18+ for mint-client bundling (esbuild) and Playwright tests.
- Sugar gotchas: uploadMethod must be `bundlr` (not `irys`); config needs ruleSet/tokenStandard/sdriveApiKey/maxEditionSupply keys; `--config` only on upload/deploy/guard add (verify/mint/guard show reject it).

## 4. Validate and deploy the Candy Machine
```bash
python3 scripts/validate_assets.py            # must pass before any deploy
./scripts/deploy.sh --validate                # validate only, no transactions
KEYPAIR=<path> ./scripts/deploy.sh --devnet   # upload + deploy + guards (+1 test mint unless SKIP_TEST_MINT=1)
RPC_URL=<private rpc> KEYPAIR=<path> ./scripts/deploy.sh --mainnet
```
Each network keeps its own cache (cache-devnet.json / cache-mainnet-beta.json). Back up the cache off-repo after every deploy.
Devnet SOL: faucet is rate-limited; Jake funds the deployer manually when needed.

## 5. Build and publish the site
```bash
scripts/build_site.sh devnet https://api.devnet.solana.com FCrJhgeHCdZyAbTPAjG6TgC3f9XeqMucoZ1mQHjbemPo
git add -A && git commit -m "..." && git push origin main   # Cloudflare auto-deploys site/
```
build_site.sh: bundles mint-client -> site/beatbots-mint.js, runs patch_site.py (injects BEATBOTS_CONFIG, real mint, live counter, theme nods, mint chime), copies audio + rhythm JS and kits.
Verify: `curl -s https://playbeatbots.pages.dev/ | grep BBRhythm` and run the browser e2e (section 8).

## 6. Sound kits (Drive -> site)
- Drive: BeatBots / Sound Kits (folder 1fVKWuqurjg4ySpn8aHG7ULadvVAjesp4), one folder per clan with one sub-folder per slot, plus a contents doc per clan and a guide doc. IDs in `tools/drive_kits.json`.
- To update: drop WAVs into the clan's slot folders, then tell Claude "kit update for <clan>". Claude pulls them, runs `tools/build_kits.py` (trim, normalise, 44.1k mono, gains from `tools/kit_gains.json`), updates kit.json + LICENSE.txt, rebuilds, tests, pushes.
- Licensing: only redistributable samples (site is public). Current sources: TR-808 set by Michael Fischer (no restrictions stated) and VCSL (CC0). Rejected: the TR-909 set (author forbids for-profit use/modification). Every new sample needs its source + license in LICENSE.txt.

## 7. Audio + rhythm engine APIs
- `BBAudio.createEngine(ctx)` voices: kick, snare, hat, perc, bass, chord, vocal, glitch, fx, keyNote, ui. Also playTrack, loadKit/useKit/kitBase/prefetchKits, lanePluck, connectVoice, renderPattern + bufferToWav (WAV export). CLANS table holds per-clan EQ, reverb/delay, root, bassline, chords. Master filter is 0-100 exponential up to 20 kHz.
- `BBRhythm`: RhythmEngine (loadBeatMap, start({travelTime, duration, onHit, onMiss, onEnd}), frame, hit(lane), stop, now via audio-clock getOutputTimestamp), RhythmSynth (pluck), LIBRARY, registerTrack, fromSequencerGrid, normalizeBeatMap, noteToMidi, SCALES, DEFAULT_LANE_MAP.
- Judgement windows: perfect 50 ms, great 90 ms, good 135 ms.
- BeatMap format: `{ id, title, bpm, bars, scale, laneNotes:[3 notes], notes:[{beat, lanes:[0..2]}], backing:{...} }`. Lanes 0/1/2 = D/F/J.
- Track 01 "Intergalactic Cypher": 96 BPM, 4 bars, A minor pentatonic, lanes A4/C5/E5, 27 notes incl. chords + syncopation.
- Station export: sequencer grid -> BeatMap via DEFAULT_LANE_MAP {0:0,4:0,1:1,6:1,3:2,5:2,7:2}; hats stay in the backing.

## 8. Tests (run before every push that touches site-src or kits)
```bash
SITE_URL=... node tools/browser_e2e.cjs        # page + mint flow
node tools/audio_test.cjs site <shotDir>       # engine voices, levels, export
node tools/rhythm_test.cjs site <shotDir>      # bot play-test, late-press, idle, station export
```
Headless tests serve the site via Playwright page.route on http://beatbots.test (the proxy blocks localhost).

## 9. Pre-mainnet checklist
- [ ] Jake supplies real treasury + DAO wallets -> `python3 scripts/set_wallets.py --treasury <W> --dao <W>` -> validate_assets.py
- [ ] Final traits/art/pricing/start date confirmed by Jake (everything can change until mainnet deploy)
- [ ] Private mainnet RPC (key kept in Cloudflare/GitHub secrets, never in chat or repo)
- [ ] Fund mainnet deployer (upload + rent; estimate before run)
- [ ] `./scripts/deploy.sh --mainnet`, back up cache off-repo
- [ ] `scripts/build_site.sh mainnet-beta <RPC> <CM>` -> push -> verify
- [ ] Attach playbeatbots.com custom domain in Cloudflare Pages

Troubleshooting: "unknown variant irys" -> bundlr. Bot tax charged but no NFT -> guard rejected (limit/date/funds); pre-flight now blocks this. Sugar "config file not found" -> solana config set. Cloudflare GitHub app stuck -> uninstall in a normal browser, reinstall on PlayBeatBots with BeatBots repo only.

## 10. CHANGE LOG (newest first; append a line for every change)
- 2026-10-23 17:05 — DECISION: music policy added (rule 7). Boombox player / TRACK_LIBRARY / ranked-vs-sandbox build is next, waiting on Jake's tracks from his iMac. — Claude
- 2026-10-23 16:45 — Runbook rewritten to current reality (was stale: Irys/Wrangler/old budget). Repo + Drive copies synced. — Claude
- 2026-10-23 16:31 — 25062a7 Rhythm battle: BeatMap engine, pluck synth, Track 01, station export. Verified: perfect bot 29/29 PERFECT S+, 70 ms late = GREAT, idle = F, station export OK, no console errors; live on pages.dev. — Claude
- 2026-10-23 16:24 — 97297a1 Pitched arcade lane notes + background kit prefetch. — Claude
- 2026-10-23 12:08 — 43c2779 Drive kit map points at uploaded Sound Kits folders (renamed "(1)" folders, added 13 slot folders, trashed old empty folder). — Claude
- 2026-10-23 11:50 — f043c8c Recorded Drive Sound Kits folder IDs. — Claude
- 2026-10-23 11:47 — 6db297f Per-clan sample kits (73 samples, CC0/808) + sampler; removed GitHub Actions workflow (Cloudflare Git integration deploys instead). — Claude
- 2026-10-23 11:17 — e0fc84f Audio engine v4 (hat gain fix, 20 kHz filter, Industrial/Biomech FX, WARM toggle) + guard-safe minting (pre-flight + NFT verify). — Claude
- 2026-10-22 18:25 — 7437c1e Site deploy via GitHub Actions (later replaced). — Claude
- 2026-10-22 18:23 — 0956f5f Real Candy Machine v3 mint on devnet; site build pipeline. — Claude
- 2026-10-22 18:04 — 65d9132 Initial Genesis kit: metadata, clan art, scripts, site. — Claude
