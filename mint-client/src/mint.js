// BeatBots real Candy Machine v3 mint client.
// Exposes window.BeatBotsMint = { init, getStats, mint, explorerTx, explorerAddress }.
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  generateSigner,
  publicKey,
  some,
  transactionBuilder,
  unwrapOption,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  fetchCandyMachine,
  mintV2,
  mplCandyMachine,
  safeFetchCandyGuard,
  safeFetchMintCounterFromSeeds,
} from '@metaplex-foundation/mpl-candy-machine';
import { fetchDigitalAsset, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';

let cfg = null;
let umi = null;

function requireInit() {
  if (!umi) throw new Error('BeatBotsMint.init() has not been called');
}

function init(config) {
  if (!config || !config.rpc || !config.candyMachine) {
    throw new Error('BeatBotsMint.init needs { rpc, candyMachine, network }');
  }
  cfg = { network: 'devnet', ...config };
  umi = createUmi(cfg.rpc).use(mplCandyMachine()).use(mplTokenMetadata());
  return cfg;
}

async function loadMachine() {
  requireInit();
  const candyMachine = await fetchCandyMachine(umi, publicKey(cfg.candyMachine));
  const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
  return { candyMachine, candyGuard };
}

function guardValue(candyGuard, name) {
  if (!candyGuard) return null;
  return unwrapOption(candyGuard.guards[name]);
}

// Live numbers for the page: minted / total / price / start date.
async function getStats() {
  const { candyMachine, candyGuard } = await loadMachine();
  const sol = guardValue(candyGuard, 'solPayment');
  const start = guardValue(candyGuard, 'startDate');
  const limit = guardValue(candyGuard, 'mintLimit');
  return {
    minted: Number(candyMachine.itemsRedeemed),
    total: Number(candyMachine.data.itemsAvailable),
    priceSol: sol ? Number(sol.lamports.basisPoints) / 1e9 : 0,
    startDate: start ? new Date(Number(start.date) * 1000) : null,
    perWalletLimit: limit ? limit.limit : null,
    guarded: !!candyGuard,
  };
}

// How many this wallet has minted / may still mint under the mintLimit guard
async function walletMinted(owner, loaded) {
  requireInit();
  const { candyMachine, candyGuard } = loaded || (await loadMachine());
  const limit = guardValue(candyGuard, 'mintLimit');
  if (!limit || !owner) return { minted: 0, limit: null, remaining: Infinity };
  const counter = await safeFetchMintCounterFromSeeds(umi, {
    id: limit.id,
    user: publicKey(owner.toString()),
    candyGuard: candyGuard.publicKey,
    candyMachine: candyMachine.publicKey,
  });
  const minted = counter ? Number(counter.count) : 0;
  return { minted, limit: limit.limit, remaining: Math.max(0, limit.limit - minted) };
}

// Mirror the guards before sending, so a mint the guard would reject never costs the bot tax
async function preflight(owner, quantity, loaded) {
  const { candyMachine, candyGuard } = loaded;
  const left = Number(candyMachine.data.itemsAvailable) - Number(candyMachine.itemsRedeemed);
  if (left <= 0) throw new Error('Sold out.');
  if (quantity > left) throw new Error(`Only ${left} BeatBot${left === 1 ? '' : 's'} left — lower the quantity.`);
  const start = guardValue(candyGuard, 'startDate');
  if (start && Date.now() < Number(start.date) * 1000) {
    throw new Error(`The mint has not started yet. It opens ${new Date(Number(start.date) * 1000).toLocaleString()}.`);
  }
  const end = guardValue(candyGuard, 'endDate');
  if (end && Date.now() > Number(end.date) * 1000) throw new Error('The mint has ended.');
  const w = await walletMinted(owner, loaded);
  if (w.limit != null && quantity > w.remaining) {
    throw new Error(w.remaining === 0
      ? `This wallet has reached the limit of ${w.limit} BeatBots.`
      : `This wallet can mint ${w.remaining} more (limit ${w.limit} per wallet).`);
  }
  const sol = guardValue(candyGuard, 'solPayment');
  const price = sol ? Number(sol.lamports.basisPoints) : 0;
  const balance = Number((await umi.rpc.getBalance(publicKey(owner.toString()))).basisPoints);
  const needed = quantity * (price + 25_000_000); // price + ~0.025 SOL rent and fees per NFT
  if (balance < needed) {
    throw new Error(`Not enough SOL: about ${(needed / 1e9).toFixed(3)} SOL needed, wallet has ${(balance / 1e9).toFixed(3)}.`);
  }
}

// After confirmation, make sure an NFT really exists (a guard rejection still lands as a successful tx)
async function nftExists(mintAddress) {
  for (let i = 0; i < 6; i++) {
    if (await umi.rpc.accountExists(mintAddress, { commitment: 'confirmed' })) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function friendlyError(err) {
  const msg = String((err && (err.message || err.toString())) || err);
  const logs = (err && err.logs ? err.logs.join('\n') : '') + '\n' + msg;
  if (/User rejected|rejected the request|declined/i.test(msg)) return 'You cancelled the transaction in your wallet.';
  if (/MintLimit|mint limit/i.test(logs)) return 'This wallet has reached the mint limit.';
  if (/MintNotLive|not live|StartDate/i.test(logs)) return 'The mint has not started yet.';
  if (/CandyMachineEmpty|NotEnoughItems|sold out/i.test(logs)) return 'Sold out.';
  if (/insufficient (funds|lamports)|NotEnoughSOL|0x1\b/i.test(logs)) return 'Not enough SOL in this wallet for the mint price plus fees.';
  if (/BotTax|bot tax/i.test(logs)) return 'The transaction was rejected by the bot-protection guard.';
  return msg.length > 220 ? msg.slice(0, 220) + '…' : msg;
}

async function readRevealed(mintAddress) {
  try {
    const asset = await fetchDigitalAsset(umi, mintAddress);
    const res = await fetch(asset.metadata.uri);
    const json = await res.json();
    return { name: json.name || asset.metadata.name, image: json.image, attributes: json.attributes || [], uri: asset.metadata.uri };
  } catch (_) {
    return null;
  }
}

/**
 * Mint `quantity` NFTs, one transaction each, with the connected wallet.
 * provider: an injected wallet (Phantom/Solflare/Backpack) that is already connected.
 * onProgress({ index, quantity, stage, signature }) is called as each mint proceeds.
 * Returns [{ mint, signature, revealed }].
 */
async function mint({ provider, quantity = 1, onProgress } = {}) {
  requireInit();
  if (!provider || !provider.publicKey) throw new Error('Connect a wallet first.');
  umi.use(walletAdapterIdentity(provider));

  const loaded = await loadMachine();
  const { candyMachine, candyGuard } = loaded;
  if (!candyGuard) throw new Error('Mint is not configured yet (no Candy Guard found).');
  await preflight(provider.publicKey, quantity, loaded);

  const mintArgs = {};
  const sol = guardValue(candyGuard, 'solPayment');
  if (sol) mintArgs.solPayment = some({ destination: sol.destination });
  const limit = guardValue(candyGuard, 'mintLimit');
  if (limit) mintArgs.mintLimit = some({ id: limit.id });

  const results = [];
  for (let i = 0; i < quantity; i++) {
    const nftMint = generateSigner(umi);
    onProgress && onProgress({ index: i, quantity, stage: 'signing' });
    try {
      const { signature } = await transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 800_000 }))
        .add(
          mintV2(umi, {
            candyMachine: candyMachine.publicKey,
            candyGuard: candyGuard.publicKey,
            nftMint,
            collectionMint: candyMachine.collectionMint,
            collectionUpdateAuthority: candyMachine.authority,
            tokenStandard: candyMachine.tokenStandard,
            mintArgs,
          })
        )
        .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
      const sig = base58.deserialize(signature)[0];
      if (!(await nftExists(nftMint.publicKey))) {
        const e = new Error('The Candy Guard rejected this mint, so no BeatBot was created (the 0.01 SOL bot tax may have been charged).');
        e.signature = sig;
        throw e;
      }
      onProgress && onProgress({ index: i, quantity, stage: 'confirmed', signature: sig });
      const revealed = await readRevealed(nftMint.publicKey);
      results.push({ mint: nftMint.publicKey.toString(), signature: sig, revealed });
    } catch (err) {
      if (err && err.signature) { err.completed = results; throw err; }
      const e = new Error(friendlyError(err));
      e.cause = err;
      e.completed = results;
      throw e;
    }
  }
  return results;
}

function clusterParam() {
  return cfg && cfg.network === 'devnet' ? '?cluster=devnet' : '';
}

const explorerTx = (sig) => `https://solscan.io/tx/${sig}${clusterParam()}`;
const explorerAddress = (addr) => `https://solscan.io/account/${addr}${clusterParam()}`;

window.BeatBotsMint = { init, getStats, walletMinted, mint, explorerTx, explorerAddress };
