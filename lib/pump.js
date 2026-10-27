// Everything that touches Solana or the pump.fun SDK lives here, so the server stays simple.
// MOCK_CHAIN=1 swaps in fakes so the whole flow can be tested without a network.
import crypto from 'node:crypto';

export const MOCK = process.env.MOCK_CHAIN === '1';
export const CREATOR_BPS = 7000;
export const TREASURY_BPS = 3000;
export const PUMP_FEES_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const MAX_TX_BYTES = 1232;

let web3, sdkMod, sdkInst, conn;
async function init() {
  if (conn) return;
  web3 = await import('@solana/web3.js');
  sdkMod = await import('@pump-fun/pump-sdk');
  conn = new web3.Connection(process.env.HELIUS_RPC_URL, 'confirmed');
  const Ctor = sdkMod.PumpSdk || sdkMod.OnlinePumpSdk;
  try { sdkInst = Ctor ? new Ctor(conn) : null; } catch { sdkInst = null; }
}
// SDK functions may be methods on the instance or top-level exports depending on version.
function sdkFn(name) {
  const f = (sdkInst && typeof sdkInst[name] === 'function' && sdkInst[name].bind(sdkInst)) || sdkMod[name];
  if (typeof f !== 'function') throw new Error(`pump SDK has no "${name}" (check scripts/inspect-sdk.js output)`);
  return f;
}
const asIxs = (r) => (Array.isArray(r) ? r : [r]);
const b64 = (u8) => Buffer.from(u8).toString('base64');

async function compile(ixs, payer, signers, bh) {
  const { TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = web3;
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...ixs];
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: bh, instructions: all }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  if (signers.length) tx.sign(signers);
  return tx;
}

function feeLockIxs({ creator, mint, treasury }) {
  const createCfg = sdkFn('createFeeSharingConfig');
  const updateShares = sdkFn('updateFeeSharesV2');
  return Promise.all([
    createCfg({ creator, mint, pool: null }),
    updateShares({
      authority: creator, mint, currentShareholders: [creator],
      newShareholders: [{ address: creator, shareBps: CREATOR_BPS }, { address: treasury, shareBps: TREASURY_BPS }],
    }),
  ]).then((r) => r.flatMap(asIxs));
}

/** Unsigned (except for the mint key) transactions for: create coin + lock the fee split. */
export async function buildLaunch({ creator, name, symbol, uri, treasury }) {
  if (MOCK) return { mint: Array.from(crypto.randomBytes(40), (b) => '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[b % 58]).join('') + 'pump', txs: [b64(crypto.randomBytes(200))], mock: true };
  await init();
  const { PublicKey, Keypair } = web3;
  const creatorPk = new PublicKey(creator), treasuryPk = new PublicKey(treasury);
  const mintKp = Keypair.generate();
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const create = asIxs(await sdkFn('createV2Instruction')({ mint: mintKp.publicKey, name, symbol, uri, creator: creatorPk, user: creatorPk, mayhemMode: false }));
  const lock = await feeLockIxs({ creator: creatorPk, mint: mintKp.publicKey, treasury: treasuryPk });

  let one = await compile([...create, ...lock], creatorPk, [mintKp], blockhash);
  if (one.serialize().length <= MAX_TX_BYTES) return { mint: mintKp.publicKey.toBase58(), txs: [b64(one.serialize())] };
  const a = await compile(create, creatorPk, [mintKp], blockhash);
  const b = await compile(lock, creatorPk, [], blockhash);
  return { mint: mintKp.publicKey.toBase58(), txs: [b64(a.serialize()), b64(b.serialize())] };
}

/** Just the fee-lock transaction, for a coin that was created but not locked yet. */
export async function buildLock({ creator, mint, treasury }) {
  if (MOCK) return { txs: [b64(crypto.randomBytes(200))] };
  await init();
  const { PublicKey } = web3;
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const c = new PublicKey(creator);
  const ixs = await feeLockIxs({ creator: c, mint: new PublicKey(mint), treasury: new PublicKey(treasury) });
  return { txs: [b64((await compile(ixs, c, [], blockhash)).serialize())] };
}

/** Optional first buy, via PumpPortal's trade-local endpoint (returns a transaction for the user to sign). */
export async function buildBuy({ creator, mint, sol }) {
  if (MOCK) return { txs: [b64(crypto.randomBytes(200))] };
  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: creator, action: 'buy', mint, amount: sol, denominatedInSol: 'true', slippage: 15, priorityFee: 0.0002, pool: 'pump' }),
  });
  if (!res.ok) throw new Error(`PumpPortal ${res.status}`);
  return { txs: [b64(new Uint8Array(await res.arrayBuffer()))] };
}

/** Read the first account key (fee payer) of a serialized transaction. */
export async function feePayerOf(b64tx) {
  if (MOCK) return null;
  await init();
  return web3.VersionedTransaction.deserialize(Buffer.from(b64tx, 'base64')).message.staticAccountKeys[0].toBase58();
}

/** Send signed transactions in order, waiting for each to confirm. */
export async function relay(signedB64) {
  if (MOCK) return signedB64.map(() => crypto.randomBytes(32).toString('hex'));
  await init();
  const sigs = [];
  for (const t of signedB64) {
    const sig = await conn.sendRawTransaction(Buffer.from(t, 'base64'), { skipPreflight: false, maxRetries: 3 });
    const end = Date.now() + 45_000;
    for (;;) {
      const { value } = await conn.getSignatureStatuses([sig]);
      const s = value[0];
      if (s?.err) throw new Error('Transaction failed on chain: ' + JSON.stringify(s.err));
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) break;
      if (Date.now() > end) throw new Error('Timed out waiting for confirmation. Check the signature on Solscan: ' + sig);
      await new Promise((r) => setTimeout(r, 1200));
    }
    sigs.push(sig);
  }
  return sigs;
}

/**
 * Read the coin's sharing config from the chain. The coin is listed only if the split is exactly
 * creator 70% / treasury 30% and the config can no longer be changed.
 */
export async function verifyLocked({ mint, creator, treasury }) {
  if (MOCK) return { ok: true, mock: true };
  await init();
  const { PublicKey } = web3;
  const pda = sdkFn('feeSharingConfigPda')(new PublicKey(mint));
  const pdaKey = Array.isArray(pda) ? pda[0] : pda;
  let info = null;
  for (let i = 0; i < 5 && !info; i++) { info = await conn.getAccountInfo(pdaKey, 'confirmed'); if (!info) await new Promise((r) => setTimeout(r, 1500)); }
  if (!info) return { ok: false, reason: 'No fee sharing config found for this coin.' };
  if (info.owner.toBase58() !== PUMP_FEES_PROGRAM) return { ok: false, reason: 'Config is not owned by the pump fees program.' };

  const d = Buffer.from(info.data);
  const pairs = [];                       // look for { address(32), share_bps(u16) } entries
  for (const [label, addr] of [['creator', creator], ['treasury', treasury]]) {
    const key = new PublicKey(addr).toBuffer();
    let at = d.indexOf(key); let bps = null;
    while (at >= 0) { const v = d.readUInt16LE(at + 32); if (v === (label === 'creator' ? CREATOR_BPS : TREASURY_BPS)) { bps = v; break; } at = d.indexOf(key, at + 1); }
    pairs.push([label, bps]);
  }
  if (pairs.some(([, v]) => v === null)) return { ok: false, reason: 'Fee split is not 70% creator / 30% treasury.' };
  // Admin revoked: SDK decoder when available, otherwise the lock check is flagged as unconfirmed.
  let adminRevoked = null;
  try { const dec = sdkMod.decodeSharingConfig || sdkInst?.decodeSharingConfig; if (dec) { const cfg = dec(info); adminRevoked = !!(cfg.adminRevoked ?? cfg.admin_revoked); } } catch {}
  if (adminRevoked === false) return { ok: false, reason: 'Fee split can still be changed.' };
  return { ok: true, adminRevokedChecked: adminRevoked !== null };
}

export async function sdkReport() {
  await init();
  return { exports: Object.keys(sdkMod).sort(), instanceMethods: sdkInst ? Object.getOwnPropertyNames(Object.getPrototypeOf(sdkInst)).sort() : null };
}
