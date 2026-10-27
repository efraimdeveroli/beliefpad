// Every 5 minutes: read each coin's holders, update their hold clocks, score the coin, keep the history.
import * as store from './store.js';
import { fetchHolders, classifyOwners, SUPPLY } from './holders.js';
import { priceUsd } from './market.js';
import { curveReserves } from './pump.js';
import { scoreCoin, K } from './belief.js';

export const SNAPSHOT_MS = 5 * 60e3;
const KEEP = 24 * 12 + 12;               // a little over 24 hours of snapshots
let nextAt = Date.now() + SNAPSHOT_MS;
let running = false;
export const nextSnapshotAt = () => nextAt;

async function snapshotCoin(coin, now) {
  const st = store.coinState(coin.mint);
  const holders = await fetchHolders(coin.mint);

  // classify owners we have not seen: plain wallets count, programs and pools (curve, AMM) do not
  const unknown = [...holders.keys()].filter((o) => !(o in st.owners));
  if (unknown.length) { const c = await classifyOwners(unknown); for (const [o, isWallet] of c) st.owners[o] = isWallet; }

  // price (needs the curve only as a fallback)
  let curve = null;
  try { curve = await curveReserves(coin.mint); } catch (e) { console.log(`[tracker] ${coin.symbol}: curve read failed: ${String(e.message || e).slice(0, 160)}`); }
  let px = null;
  try { px = await priceUsd(coin.mint, curve); } catch (e) { console.log(`[tracker] ${coin.symbol}: price failed: ${String(e.message || e).slice(0, 160)}`); }
  if (!px) { console.log(`[tracker] ${coin.symbol}: no price yet, skipping`); return; }
  st.market = { price: px.price, mcap: px.price * SUPPLY, source: px.source, at: now };

  // hold clocks: a wallet's clock starts when we first see it, resets when it empties, and tracks its peak
  let circulating = 0;
  const wallets = [];
  for (const [owner, amount] of holders) {
    const isWallet = st.owners[owner] !== false;
    if (isWallet) circulating += amount;
    let w = st.wallets[owner];
    if (!w) w = st.wallets[owner] = { t0: now, peak: amount };
    else if (amount > w.peak) w.peak = amount;
    wallets.push({ owner, amount, t0: w.t0, peak: w.peak, excluded: !isWallet || owner === coin.creator, curveOrPool: !isWallet });
  }
  for (const owner of Object.keys(st.wallets)) if (!holders.has(owner)) delete st.wallets[owner];   // sold everything: clock resets

  const s = scoreCoin({ wallets, now, priceUsd: px.price, circulating });
  st.snaps.push({ t: now, b: s.belief, h: s.H, B: s.B, mu: s.mu, R: s.R, Q: s.Q, top10: s.top10, reach: s.reach, spread: s.spread });
  if (st.snaps.length > KEEP) st.snaps.splice(0, st.snaps.length - KEEP);
  console.log(`[tracker] ${coin.symbol}: holders ${holders.size}, counted ${s.H}, belief ${s.belief.toFixed(0)}, $${px.price.toExponential(2)} (${px.source})`);
}

export async function runSnapshots() {
  if (running) return;
  running = true;
  const now = Date.now();
  try {
    for (const coin of store.listCoins({ status: 'locked', limit: 1000 })) {
      try { await snapshotCoin(coin, now); } catch (e) { console.error(`[tracker] ${coin.symbol}:`, String(e.message).slice(0, 200)); }
    }
    store.saveState();
  } finally { running = false; nextAt = Date.now() + SNAPSHOT_MS; }
}

export function startTracker() {
  setTimeout(runSnapshots, 5_000);
  setInterval(runSnapshots, SNAPSHOT_MS).unref();
}

// ---- what the board shows
const avg = (a) => a.reduce((s, x) => s + x.b, 0) / a.length;
const MIN_AGE_H = 0.25, MIN_HOLDERS = 5;

export function boardData() {
  const now = Date.now(), ranked = [], warming = [];
  for (const coin of store.listCoins({ status: 'locked', limit: 1000 })) {
    const st = store.coinState(coin.mint), snaps = st.snaps, last = snaps[snaps.length - 1];
    const ageH = (now - coin.createdAt) / 3600e3;
    const gated = !last || ageH < MIN_AGE_H || last.h < MIN_HOLDERS;   // not ranked yet, but still shown on the board
    if (gated) warming.push({ n: coin.name, t: coin.symbol, age_min: Math.floor(ageH * 60), H: last ? last.h : 0, mint: coin.mint });
    if (!last) {
      ranked.push({ n: coin.name, t: coin.symbol, mint: coin.mint, creator: coin.creator, image: `/img/${coin.mint}`, H: 0, mu: 0, R: 0, Q: 0, top10: 0, age: ageH, mc: 0, b: 0, d: 0, w: 0, B: 0, reach: 0, spread: 1, spark: Array(24).fill(null).map((_, i) => i === 23 ? 0 : null), pump: `https://pump.fun/coin/${coin.mint}`, ranked: false, fresh: true });
      continue;
    }
    const shown = (arr) => Math.round(avg(arr.slice(-3)));            // average of the last three snapshots
    const val = shown(snaps);
    const old = snaps.length >= 6 ? shown(snaps.slice(0, -3)) : snaps.length > 3 ? shown(snaps.slice(0, 1)) : val;
    // 24 hourly points ending now; hours before launch stay empty
    const spark = Array.from({ length: 24 }, (_, i) => {
      const t = now - (23 - i) * 3600e3, upto = snaps.filter((x) => x.t <= t + 150e3);
      return upto.length && t >= coin.createdAt - 3600e3 ? Math.round(avg(upto.slice(-3))) : null;
    });
    spark[23] = val;
    const w = last.H ? last.B / last.H : 0;
    ranked.push({ n: coin.name, t: coin.symbol, mint: coin.mint, creator: coin.creator, image: `/img/${coin.mint}`, H: last.h, mu: last.mu, R: last.R, Q: last.Q, top10: last.top10,
      age: ageH, mc: st.market?.mcap || 0, b: val, d: val - old, w, B: last.B, reach: last.reach, spread: last.spread, spark, pump: `https://pump.fun/coin/${coin.mint}`, ranked: !gated, fresh: false });
  }
  ranked.sort((a, z) => (z.ranked - a.ranked) || (a.ranked ? z.b - a.b : a.age - z.age));
  return { generatedAt: now, nextSnapshotAt: nextAt, const: K, coins: ranked, warming, total: ranked.length };
}
