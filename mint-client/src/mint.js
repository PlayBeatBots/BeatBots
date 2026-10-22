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

  const { candyMachine, candyGuard } = await loadMachine();
  if (!candyGuard) throw new Error('Mint is not configured yet (no Candy Guard found).');

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
      onProgress && onProgress({ index: i, quantity, stage: 'confirmed', signature: sig });
      const revealed = await readRevealed(nftMint.publicKey);
      results.push({ mint: nftMint.publicKey.toString(), signature: sig, revealed });
    } catch (err) {
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

window.BeatBotsMint = { init, getStats, mint, explorerTx, explorerAddress };
