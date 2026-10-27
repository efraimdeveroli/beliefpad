// Price and market cap in USD. DexScreener first; bonding-curve maths as a fallback for brand-new coins.
let sol = { v: 0, at: 0 };
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}
export async function solUsd() {
  if (Date.now() - sol.at < 60_000 && sol.v) return sol.v;
  const j = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
  sol = { v: Number(j.solana.usd), at: Date.now() };
  return sol.v;
}
export async function priceUsd(mint, curve) {
  try {
    const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const pairs = (j.pairs || []).filter((p) => p.priceUsd).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    if (pairs[0]) return { price: Number(pairs[0].priceUsd), source: 'dexscreener' };
  } catch (e) { console.log(`[market] dexscreener: ${String(e.message || e).slice(0, 120)}`); }
  if (curve) {
    const s = await solUsd();
    return { price: (curve.vSol / 1e9) / (curve.vTokens / 1e6) * s, source: 'curve' };
  }
  return null;
}
