// Reads every holder of a coin through Helius' DAS getTokenAccounts, plus market data for pricing.
const RPC = () => process.env.HELIUS_RPC_URL;
export const DECIMALS = 6;               // pump.fun coins use 6 decimals
export const SUPPLY = 1_000_000_000;     // and a fixed 1B supply

async function rpc(method, params) {
  const res = await fetch(RPC(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'bp', method, params }) });
  if (!res.ok) throw new Error(`RPC ${method} ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

/** { owner -> amount in whole coins } for every token account with a balance. */
export async function fetchHolders(mint, maxPages = 12) {
  const byOwner = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const r = await rpc('getTokenAccounts', { mint, page, limit: 1000, options: { showZeroBalance: false } });
    const rows = r?.token_accounts || [];
    for (const a of rows) byOwner.set(a.owner, (byOwner.get(a.owner) || 0) + Number(a.amount) / 10 ** DECIMALS);
    if (rows.length < 1000) break;
  }
  return byOwner;
}

/** Owners that are programs or PDAs (bonding curve, pools, vaults) are not people: true if it is a plain wallet. */
export async function classifyOwners(owners) {
  const out = new Map();
  for (let i = 0; i < owners.length; i += 100) {
    const batch = owners.slice(i, i + 100);
    const r = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    r.value.forEach((info, j) => out.set(batch[j], !info || info.owner === '11111111111111111111111111111111'));
  }
  return out;
}
