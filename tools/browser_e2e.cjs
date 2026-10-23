// End-to-end browser test of the BeatBots site against devnet.
// Serves ./site locally, injects a Phantom-compatible test wallet whose signing
// happens in Node with a devnet keypair, then mints through the real UI.
// Usage: node browser_e2e.cjs <siteDir> <keypair.json> <quantity> <screenshotDir>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { Keypair, PublicKey } = require('/home/claude/beatbots/mintjs/node_modules/@solana/web3.js');
const nacl = require('/home/claude/beatbots/mintjs/node_modules/tweetnacl');

const [siteDir, keyPath, qtyArg, shotDir] = process.argv.slice(2);
const qty = Number(qtyArg || 1);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath))));
const addr = kp.publicKey.toBase58();

const types = { '.html': 'text/html', '.js': 'application/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(siteDir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(siteDir) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  const browser = await chromium.launch({
    proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' },
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  // Serve the site from disk for http://beatbots.test/* (no local server, nothing leaves the machine)
  await page.route('http://beatbots.test/**', route => {
    const u = new URL(route.request().url());
    const p = path.join(siteDir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!p.startsWith(siteDir) || !fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: types[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });
  });
  const errors = []; global.__errs = errors;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', async d => { console.log('DIALOG:', d.message()); await d.dismiss(); });

  await page.exposeFunction('__testSign', (msgBytes) =>
    Array.from(nacl.sign.detached(Uint8Array.from(msgBytes), kp.secretKey)));

  await page.addInitScript((address) => {
    // Phantom-compatible stand-in; real signing happens in Node via __testSign
    window.__testWallet = {
      isPhantom: true,
      publicKey: null,
      _handlers: {},
      on(ev, fn) { this._handlers[ev] = fn; },
      off() {},
      async connect() {
        this.publicKey = new window.solanaWeb3.PublicKey(address);
        return { publicKey: this.publicKey };
      },
      async disconnect() {},
      async signTransaction(tx) {
        const sig = await window.__testSign(Array.from(tx.message.serialize()));
        const idx = tx.message.staticAccountKeys.findIndex(k => k.toBase58() === address);
        tx.signatures[idx] = Uint8Array.from(sig);
        return tx;
      },
      async signAllTransactions(txs) { for (const t of txs) await this.signTransaction(t); return txs; },
    };
    Object.defineProperty(window, 'phantom', { value: { solana: window.__testWallet }, configurable: true });
  }, addr);

  await page.goto(process.env.SITE_URL || 'http://beatbots.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /^\d+$/.test(document.getElementById('minted-count')?.textContent || ''), null, { timeout: 60000 });
  const before = Number(await page.textContent('#minted-count'));
  const cluster = await page.textContent('#cluster-label');
  console.log('cluster label:', cluster, '| minted before:', before, '| total:', await page.textContent('#mint-total'));
  await page.screenshot({ path: path.join(shotDir, '1_loaded.png') });

  await page.click('#wallet-connect-btn');
  await page.click('#connect-phantom-btn');
  await page.waitForFunction(() => /Phantom|\(/.test(document.getElementById('wallet-btn-text')?.textContent || ''), null, { timeout: 30000 });
  console.log('wallet button:', (await page.textContent('#wallet-btn-text')).trim());

  for (let i = 1; i < qty; i++) await page.click('#qty-plus');
  await page.click('#open-mint-modal-btn');
  await page.click('#execute-mint-btn');
  await page.waitForSelector('#modal-step-success:not(.hidden)', { timeout: 180000 });
  await page.waitForTimeout(1500);
  console.log('revealed:', await page.textContent('#modal-bot-id'), '|', await page.textContent('#modal-bot-clan'));
  console.log('image src:', (await page.getAttribute('#modal-bot-image', 'src')).slice(0, 90));
  console.log('tx links:', await page.$$eval('#modal-step-success p a', as => as.map(a => a.href)));
  await page.screenshot({ path: path.join(shotDir, '2_minted.png') });

  await page.waitForFunction((b) => Number(document.getElementById('minted-count').textContent) > b, before, { timeout: 60000 });
  console.log('minted after:', await page.textContent('#minted-count'), '| pct:', await page.textContent('#mint-pct'));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(async e => { console.error('E2E FAIL:', e.message); console.error('page errors:', JSON.stringify(global.__errs || [])); process.exit(1); });
