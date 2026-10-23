#!/usr/bin/env python3
"""Patch the BeatBots index.html: real Candy Machine mint, live counter, network config, theme nods.
Usage: patch_site.py <in.html> <out.html> <network> <rpc> <candyMachine>
"""
import re
import sys

src, out, network, rpc, cm = sys.argv[1:6]
s = open(src, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f"expected {count} match(es), found {n}: {old[:80]!r}")
    s = s.replace(old, new)


# ---- 1. Config + mint bundle, loaded before the page logic ------------------
cfg_block = f"""<script>
    // Network config for the mint. Switch these three values for mainnet.
    window.BEATBOTS_CONFIG = {{
      network: "{network}",
      rpc: "{rpc}",
      candyMachine: "{cm}"
    }};
  </script>
  <script src="beatbots-mint.js"></script>
  <script>window.BeatBotsMint.init(window.BEATBOTS_CONFIG);</script>

  <!-- SCRIPT LOGIC"""
rep("<!-- SCRIPT LOGIC", cfg_block)

# ---- 2. Network: use config, no mainnet/devnet toggle ------------------------
rep('const RPC_URL = "https://api.mainnet-beta.solana.com";', "const RPC_URL = window.BEATBOTS_CONFIG.rpc;")
rep("let currentCluster = 'mainnet-beta'; // 'mainnet-beta' or 'devnet'",
    "let currentCluster = window.BEATBOTS_CONFIG.network;")
rep('<strong id="cluster-label" class="text-bass-toxic">MAINNET-BETA</strong>',
    f'<strong id="cluster-label" class="{"text-bass-amber" if network == "devnet" else "text-bass-toxic"}">{network.upper()}</strong>')
m = re.search(r"        clusterBtn\.addEventListener\('click', \(\) => \{\n.*?\n        \}\);\n", s, re.S)
if not m:
    sys.exit("cluster click handler not found")
s = s[:m.start()] + """        clusterBtn.addEventListener('click', () => {
          const n = window.BEATBOTS_CONFIG.network;
          alert(n === 'devnet'
            ? 'This site is minting on Solana DEVNET (test network). Switch your wallet to Devnet and use free devnet SOL.'
            : 'This site mints on Solana Mainnet.');
        });
""" + s[m.end():]

# ---- 3. No fake balances / explorer links on the wrong network ---------------
rep("return userSolBalance || 1.25;", "return userSolBalance || 0;")
rep("if (solscanLink) solscanLink.href = `https://solscan.io/account/${pubkeyStr}`;",
    "if (solscanLink) solscanLink.href = window.BeatBotsMint.explorerAddress(pubkeyStr);")

# ---- 4. Live mint counter instead of hard-coded 704/888 -----------------------
rep('<span class="text-white font-bold"><span id="minted-count">704</span> / 888 (80%)</span>',
    '<span class="text-white font-bold"><span id="minted-count">—</span> / <span id="mint-total">888</span> (<span id="mint-pct">0</span>%)</span>')
rep('<div class="bg-gradient-to-r from-bass-toxic to-emerald-400 h-full rounded-full" style="width: 80%"></div>',
    '<div id="mint-progress-bar" class="bg-gradient-to-r from-bass-toxic to-emerald-400 h-full rounded-full" style="width: 0%"></div>')

# ---- 5. Replace the fake mint handler with the real Candy Machine mint --------
start = s.index("      executeMintBtn.addEventListener('click', async () => {")
end_marker = "      // Sequencer controls"
end = s.index(end_marker, start)
real_handler = r"""      executeMintBtn.addEventListener('click', async () => {
        if (!isWalletConnected || !activeProvider || !userPubkey) {
          alert('Please connect your Solana wallet first!');
          if (mintModal) mintModal.classList.add('hidden');
          if (walletModal) walletModal.classList.remove('hidden');
          return;
        }

        const priceSol = (window.__beatbotsStats && window.__beatbotsStats.priceSol) || 0.5;
        const totalCostSol = mintQty * priceSol;
        mintSpinner.classList.remove('hidden');
        executeMintBtn.disabled = true;
        mintBtnLabel.textContent = `CONFIRM IN WALLET (1 of ${mintQty})...`;

        try {
          const results = await window.BeatBotsMint.mint({
            provider: activeProvider,
            quantity: mintQty,
            onProgress: (p) => {
              mintBtnLabel.textContent = p.stage === 'signing'
                ? `CONFIRM IN WALLET (${p.index + 1} of ${p.quantity})...`
                : `MINTED ${p.index + 1} of ${p.quantity}...`;
            }
          });
          showMintSuccess(results);
        } catch (err) {
          console.error('Mint failed:', err.cause || err);
          const done = (err.completed || []).length;
          if (done) showMintSuccess(err.completed);
          alert(`Mint did not complete: ${err.message}` + (done ? `\n(${done} BeatBot${done > 1 ? 's were' : ' was'} minted before this.)` : ''));
        } finally {
          mintSpinner.classList.add('hidden');
          executeMintBtn.disabled = false;
          mintBtnLabel.textContent = `APPROVE & MINT (${totalCostSol.toFixed(2)} SOL)`;
          refreshMintStats();
          if (userPubkey) fetchUserBalance(userPubkey).then(b => updateWalletUIConnected(activeWalletType, userPubkey.toString(), b));
        }
      });

      // Show the NFT(s) actually minted, read back from the chain
      function showMintSuccess(results) {
        if (!results || !results.length) return;
        modalStepPre.classList.add('hidden');
        modalStepSuccess.classList.remove('hidden');

        const txEl = document.querySelector('#modal-step-success p');
        if (txEl) {
          txEl.innerHTML = results.map(r =>
            `<a href="${window.BeatBotsMint.explorerTx(r.signature)}" target="_blank" rel="noopener" class="text-bass-cyan underline hover:text-white font-mono">TX ${r.signature.slice(0, 8)}…</a>`
          ).join(' · ');
        }

        if (typeof uiSound === 'function') uiSound('chime');
        const last = results[results.length - 1];
        const rv = last.revealed;
        const botImg = document.getElementById('modal-bot-image');
        const botId = document.getElementById('modal-bot-id');
        const botClan = document.getElementById('modal-bot-clan');
        if (rv) {
          const attr = (t) => ((rv.attributes || []).find(a => a.trait_type === t) || {}).value;
          if (botImg && rv.image) botImg.src = rv.image;
          if (botId) botId.textContent = (rv.name || 'BeatBot').toUpperCase();
          if (botClan) botClan.textContent = [attr('Clan'), attr('Visual Edition')].filter(Boolean).join(' — ');
        } else {
          if (botId) botId.textContent = 'BEATBOT MINTED';
          if (botClan) botClan.textContent = 'Artwork is still loading — check your wallet in a minute.';
        }
        if (results.length > 1 && botId) botId.textContent += `  (+${results.length - 1} more)`;
      }

      // Live minted / total counter from the Candy Machine
      async function refreshMintStats() {
        try {
          const st = await window.BeatBotsMint.getStats();
          window.__beatbotsStats = st;
          const pct = st.total ? Math.floor((st.minted / st.total) * 100) : 0;
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
          set('minted-count', st.minted);
          set('mint-total', st.total);
          set('mint-pct', pct);
          const bar = document.getElementById('mint-progress-bar');
          if (bar) bar.style.width = `${pct}%`;
        } catch (e) {
          console.warn('Could not load mint stats:', e);
        }
      }
      refreshMintStats();
      setInterval(refreshMintStats, 30000);

"""
s = s[:start] + real_handler + s[end:]
for bad in ("Math.floor(Math.random() * 888)", "Fallback synthetic signature", "SystemProgram.transfer"):
    if bad in s:
        sys.exit(f"fake mint code still present: {bad}")

# ---- 6. Theme nods instead of band names; correct edition labels -------------
nods = {
    "INSPIRATION: BEASTIE BOYS": "SOUND: BROOKLYN BOOM-BAP",
    "CLAN 01 // HELLO NASTY &amp; HOT SAUCE COMMITTEE": "CLAN 01 // INTERGALACTIC CYPHER CREW",
    "CLAN 01 // HELLO NASTY & HOT SAUCE COMMITTEE": "CLAN 01 // INTERGALACTIC CYPHER CREW",
    "CLAN 01 // HELLO NASTY": "CLAN 01 // INTERGALACTIC CYPHER CREW",
    "V2 HELLO NASTY": "V2 SPEAKER-CITY",
    "Intergalactic B-Boys (Hello Nasty)": "Intergalactic B-Boys (Speaker-City)",
    "INSPIRATION: BASSNECTAR LIVE RIG": "SOUND: 140 BASS MUSIC RIG",
    "INSPIRATION: PRETTY LIGHTS": "SOUND: ELECTRO-SOUL LIGHTSHOW",
    "INSPIRATION: LINKIN PARK": "SOUND: HYBRID NU-METAL REMIX",
    "CLAN 04 // HYBRID THEORY & REANIMATION FOUNDRY": "CLAN 04 // HYBRID RIG & REMIX FOUNDRY",
    "INSPIRATION: TOOL": "SOUND: ODD-METER PROG RITUAL",
    "CLAN 05 // LATERALUS ALEX GREY NET OF BEING": "CLAN 05 // GOLDEN SPIRAL VISIONARY TEMPLE",
    "Beastie Vocoder Lead": "Intergalactic Vocoder Lead",
    "Pretty Lights Soul Rhodes": "Electro-Soul Rhodes",
    "05: Tool 7/8 Polyrhythm": "05: Odd-Meter 7/8 Polyrhythm",
    'label: "V2 ALEX GREY TEMPLE"': 'label: "V2 VISIONARY TEMPLE"',
}
for old, new in nods.items():
    s = s.replace(old, new)
# B-Boys' first edition is the Speaker-City art, mislabeled as Cozza Frenzy
bb = s.index("bboy: {")
i = s.index('label: "V3 COZZA FRENZY STAGE"', bb)
if i > s.index("dub: {"):
    sys.exit("B-Boys Cozza label not found inside bboy block")
s = s[:i] + 'label: "V2 SPEAKER-CITY"' + s[i + len('label: "V3 COZZA FRENZY STAGE"'):]

# ---- 7. Real network badge and real rarity in the reveal ---------------------
rep('<span class="px-2 py-0.5 rounded bg-bass-toxic/20 text-bass-toxic text-xs font-mono font-bold">SOLANA MAINNET SIMULATOR</span>',
    f'<span class="px-2 py-0.5 rounded bg-bass-toxic/20 text-bass-toxic text-xs font-mono font-bold">{"SOLANA DEVNET (TEST)" if network == "devnet" else "SOLANA MAINNET"}</span>')
rep('<span class="text-bass-amber text-[10px] block mt-1">RARITY: TIER 1 (MYTHIC SOUND WEAPON)</span>',
    '<span id="modal-bot-rarity" class="text-bass-amber text-[10px] block mt-1"></span>')
rep("""          if (botClan) botClan.textContent = [attr('Clan'), attr('Visual Edition')].filter(Boolean).join(' — ');""",
    """          if (botClan) botClan.textContent = [attr('Clan'), attr('Visual Edition')].filter(Boolean).join(' — ');
          const rar = document.getElementById('modal-bot-rarity');
          if (rar) rar.textContent = attr('Rarity Tier') ? `RARITY: ${String(attr('Rarity Tier')).toUpperCase()}` : '';""")

open(out, "w", encoding="utf-8").write(s)

# Report any band/artist names still visible (ignoring embedded images)
visible = re.sub(r"data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+", "", s)
left = sorted(set(re.findall(r"Beastie|Bassnectar|Pretty Lights|Linkin|Lateralus|Alex Grey|Hybrid Theory|Reanimation|Hello Nasty|\bTool\b(?! [A-Za-z]*(Tip|bar|kit))", visible, re.I)))
print("patched ->", out)
print("remaining name mentions:", left or "none")
