#!/usr/bin/env python3
"""Split the patched one-page site into separate pages.

Usage: split_pages.py <patched full index.html> <out dir>

site-src/index.html stays the single source. Every top-level block that belongs to one page is
tagged data-page="home|studio|mint" (sections, the wallet/mint modals and the mint scripts).
This writes:
  index.html   home: hero, clans, launch cards, armory, vault, token, FAQ
  studio.html  the Sound Design Station (sequencer, synth keys, FX pads)
  mint.html    the Genesis mint panel, wallet connect and mint modals (+ Solana web3 / mint bundle)
Untagged markup (status bar, side console, phone nav, footer, shared scripts) goes on every page.
Beat Battle lives in its own hand-written page, site-src/battle.html.

Links: #mint-section, #audio-section and #arcade-section point to /mint, /studio and /battle;
on studio/mint every other #anchor points back to /#anchor. The shared page script tolerates
missing sections (document.getElementById falls back to a detached element), so each page runs
the same code without errors.
"""
import re
import sys

src, outdir = sys.argv[1], sys.argv[2]
FULL = open(src, encoding="utf-8").read()

PAGES = {
    "home": {
        "file": "index.html", "path": "/",
    },
    "studio": {
        "file": "studio.html", "path": "/studio", "mod": "/studio",
        "title": "Sound Design Station | BeatBots",
        "desc": "Make beats in your browser with BeatBots clan sound kits: an 8-channel 16-step sequencer, playable synth keys and live FX pads.",
    },
    "mint": {
        "file": "mint.html", "path": "/mint", "mod": "/mint",
        "title": "Genesis Mint (Devnet Test) | BeatBots",
        "desc": "Mint a Genesis BeatBot on Solana devnet (test). Mainnet date TBA.",
    },
}
MOVED = {"mint-section": "/mint", "audio-section": "/studio", "arcade-section": "/battle"}
TAG_RE = re.compile(r'<(section|div|script)\b[^>]*\bdata-page="(\w+)"[^>]*>')


def block_end(s, start, tag):
    """Index just past the element that opens at `start` (handles nested divs)."""
    if tag in ("section", "script"):
        close = f"</{tag}>"
        return s.index(close, start) + len(close)
    depth, i = 0, start
    rx = re.compile(r"<div\b|</div>")
    for m in rx.finditer(s, start):
        depth += 1 if m.group(0) == "<div" else -1
        if depth == 0:
            return m.end()
    raise SystemExit(f"unbalanced div at {start}")


def keep_only(s, page):
    cuts = []
    for m in TAG_RE.finditer(s):
        if m.group(2) != page:
            cuts.append((m.start(), block_end(s, m.start(), m.group(1))))
    # drop nested cuts, then cut from the end
    kept, last_end = [], -1
    for a, b in sorted(cuts):
        if a >= last_end:
            kept.append((a, b)); last_end = b
    for a, b in reversed(kept):
        # take the leading indentation/comment line with the block
        line_start = s.rfind("\n", 0, a) + 1
        prev = s.rfind("\n", 0, line_start - 1) + 1
        if s[prev:line_start].strip().startswith("<!--") and s[prev:line_start].strip().endswith("-->"):
            line_start = prev
        s = s[:line_start] + s[b:].lstrip(" ")
    return s


def must(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        raise SystemExit(f"split_pages: expected {count} of {old[:70]!r}, found {n}")
    return s.replace(old, new)


def build(page):
    cfg = PAGES[page]
    s = keep_only(FULL, page)

    # head: title, canonical, description, og/twitter tags
    if page != "home":
        s = re.sub(r"<title>.*?</title>", f"<title>{cfg['title']}</title>", s, count=1, flags=re.S)
        s = re.sub(r'(<link rel="canonical" href=")[^"]*(")', rf"\g<1>https://playbeatbots.com{cfg['path']}\2", s, count=1)
        s = re.sub(r'(<meta name="description" content=")[^"]*(")', rf"\g<1>{cfg['desc']}\2", s, count=1)
        s = re.sub(r'(<meta property="og:title" content=")[^"]*(")', rf"\g<1>{cfg['title']}\2", s, count=1)
        s = re.sub(r'(<meta property="og:description" content=")[^"]*(")', rf"\g<1>{cfg['desc']}\2", s, count=1)
        s = re.sub(r'(<meta property="og:url" content=")[^"]*(")', rf"\g<1>https://playbeatbots.com{cfg['path']}\2", s, count=1)

    # links between pages
    def href(m):
        anchor = m.group(1)
        if anchor in MOVED:
            return f'href="{MOVED[anchor]}"'
        if page == "home":
            return m.group(0)
        return 'href="/"' if anchor in ("hero-section", "top") else f'href="/#{anchor}"'
    s = re.sub(r'href="#([\w-]+)"', href, s)

    # side console: highlight this page's module
    if page != "home":
        s = s.replace('class="mod on"', 'class="mod"')
        s = must(s, f'<a class="mod" href="{cfg["mod"]}">', f'<a class="mod on" href="{cfg["mod"]}" aria-current="page">')

    # header wallet button: only the mint page connects a wallet
    if page != "mint":
        s, n = re.subn(r'<button id="wallet-connect-btn" class="btn-wallet">.*?</button>',
                       '<a class="btn-wallet" href="/mint">Mint Genesis</a>', s, count=1, flags=re.S)
        if n != 1:
            raise SystemExit("split_pages: wallet button not found")

    # shared page script -> one cached file (beatbots-app.js); tolerate sections on other pages
    marker = "<!-- SCRIPT LOGIC"
    i = s.index(marker)
    j = s.index("<script>", i)
    k = s.index("</script>", j)
    body = s[j + len("<script>"):k].replace("document.getElementById(", "bbEl(")
    app = ("// BeatBots page logic shared by index.html, studio.html and mint.html (generated by tools/split_pages.py\n"
           "// from the inline script in site-src/index.html; edit it there).\n"
           "// Sections live on different pages; a missing element becomes a detached stand-in.\n"
           "function bbEl(id) { const el = document.getElementById(id); if (el) return el; const d = document.createElement('div'); d.value = ''; return d; }\n"
           + body)
    APP.append(app)
    s = s[:j] + '<script src="beatbots-app.js"></script>' + s[k + len("</script>"):]
    s = s.replace('<html lang="en"', f'<html lang="en" data-page="{page}"', 1)
    return s


APP = []
for page, cfg in PAGES.items():
    html = build(page)
    if 'data-page="' in html.replace(f'data-page="{page}"', ""):
        leftovers = sorted(set(re.findall(r'data-page="(\w+)"', html)) - {page})
        raise SystemExit(f"split_pages: {page} still has blocks for {leftovers}")
    open(f"{outdir}/{cfg['file']}", "w", encoding="utf-8").write(html)
    print(f"  {cfg['file']}: {len(html) // 1024} KB")
if len(set(APP)) != 1:
    raise SystemExit("split_pages: page scripts differ between pages")
open(f"{outdir}/beatbots-app.js", "w", encoding="utf-8").write(APP[0])
print(f"  beatbots-app.js: {len(APP[0]) // 1024} KB (shared)")
