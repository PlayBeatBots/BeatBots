# AGENTS.md — read this first (Claude, Gemini, Grok/Nori team, any agent)

BeatBots Genesis: a Solana NFT collection (Candy Machine v3) with a browser beat engine and
rhythm battle game. The live site is https://playbeatbots.pages.dev (DEVNET ONLY).

## 1. Sources of truth
- `DEPLOYMENT_RUNBOOK.md` (this repo) — Candy Machine IDs, repo layout, build, tests, change log.
  The Drive copy is "BeatBots / Agent Ops - Claude Deployment / DEPLOYMENT_RUNBOOK.md". If they
  differ, this repo wins.
- Team task queue: Google Drive `Nori/00 Inbox/queue.md`. Everything flows through Nori.
- GitHub safety rules: Drive `Nori/01 Shared Knowledge/github-rules.md`.

## 2. Who owns what
| Agent | Owns | Can push to `main`? |
|---|---|---|
| Claude | Code, builds, deploys, Candy Machine, merges, runbook | Yes, after tests pass |
| Gemini | UI/design in `site-src/index.html` only | No: open a PR |
| Grok Dev bot (via Nori) | QA after deploys and on previews, code review, bug reports, small fixes | No. No GitHub write access yet: hands code to Claude as a patch + task file in Drive `Agent Ops/BeatBots/` with a queue item |
| Other Grok bots | Marketing, community, research | No code changes |

**Every push to `main` redeploys the live site (Cloudflare Pages).** Only Claude merges.

## 3. How to change the site
1. Branch from `main`: `fix/<topic>`, `feat/<topic>` or `perf/<topic>`.
2. Edit `site-src/` only. Never hand-edit `site/`; it is build output.
3. Build: `scripts/build_site.sh devnet https://api.devnet.solana.com FCrJhgeHCdZyAbTPAjG6TgC3f9XeqMucoZ1mQHjbemPo`
4. Test (runbook section 8): `tools/audio_test.cjs`, `tools/rhythm_test.cjs`, and the browser mint flow.
5. Hand it to Claude: a PR if you have write access, otherwise a patch file + task file in Drive
   `Agent Ops/BeatBots/` with a queue item owned by Claude. Say what you tested. Claude reviews,
   merges and verifies the live site.
6. Every branch gets a Cloudflare preview at `https://<branch-name-with-dashes>.playbeatbots.pages.dev`;
   QA it there before it is merged.
7. Add a dated line to the runbook CHANGE LOG.

Images live in `site-src/img/` as files, not as base64 in the HTML. Keep it that way so the page
stays small.

## 4. Hard rules
- Devnet only until Jake sets a mainnet date and supplies the real treasury/DAO wallets.
  Wallet addresses in Drive are placeholders.
- Never commit keys, keypairs, seed phrases, `.env` or `cache-*.json`. Never paste secrets anywhere.
- No mint date, price, supply or `$BEAT` token details in site copy or posts until Jake confirms them.
  `$SCRAP` is the in-game currency.
- Music: only original TecSupport tracks with lore titles. No copyrighted masters and no real
  band/artist names. Every sample in `site-src/kits/` needs a redistribution license in its
  `LICENSE.txt`.
- GitHub: never create accounts or switch accounts to get around a block. Use your own scoped
  access; keep to ≤20 writes/min; on a 403/429, stop and back off. No automated stars or follows.
- Anything that spends money, signs transactions or touches wallets → ask Jake first.
