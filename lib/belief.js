// The Belief formula. Same constants and steps as the docs page (docs.html#belief).
export const K = { tau: 1.5, fast: 0.85, slow: 0.15, dust: 10, scale: 10, bmax: 15000, free: 0.2, floor: 0.4 };
export const TIERS = [[10, 50, 1.0], [50, 250, 1.25], [250, 1000, 1.5], [1000, Infinity, 1.75]];

export const T = (h) => K.fast * (1 - Math.exp(-h / K.tau)) + K.slow * Math.min(h / 24, 1);
export const reach = (B) => Math.min(1, Math.log10(1 + B / K.scale) / Math.log10(1 + K.bmax / K.scale));
export const spread = (top10) => Math.max(K.floor, 1 - Math.max(0, top10 - K.free) / 0.8);
export const sizeTier = (usd) => { for (const [lo, hi, m] of TIERS) if (usd >= lo && usd < hi) return m; return 0; };

/**
 * wallets: [{ amount, t0, peak, excluded }]  amount/peak in coin units, t0 = ms when the current hold started
 * circulating: coins held outside the bonding curve and pools (for the top-10 share)
 * Returns the full breakdown for one coin at time `now`.
 */
export function scoreCoin({ wallets, now, priceUsd, circulating }) {
  let B = 0, H = 0, hold = 0, kept = 0, size = 0;
  for (const w of wallets) {
    if (w.excluded || !(w.amount > 0)) continue;
    const q = sizeTier(w.amount * priceUsd);
    if (!q) continue;                                   // under the dust line
    const hours = Math.max(0, (now - w.t0) / 3600e3);
    const r = Math.min(1, w.amount / (w.peak || w.amount));
    B += T(hours) * r * q; H++; hold += hours; kept += r; size += q;
  }
  const amounts = wallets.filter((w) => w.amount > 0 && !w.curveOrPool).map((w) => w.amount).sort((a, b) => b - a);
  const top10 = circulating > 0 ? Math.min(1, amounts.slice(0, 10).reduce((s, v) => s + v, 0) / circulating) : 0;
  const rch = reach(B), spr = spread(top10);
  return { H, B, mu: H ? hold / H : 0, R: H ? kept / H : 0, Q: H ? size / H : 0, top10, reach: rch, spread: spr, belief: 1000 * rch * spr };
}
