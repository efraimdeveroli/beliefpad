import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.js';
import * as pinata from './lib/pinata.js';
import * as pump from './lib/pump.js';
import { parseLaunch, isPubkey } from './lib/validate.js';
import { limited } from './lib/ratelimit.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dir, 'public');
const PORT = Number(process.env.PORT || 3000);
const TREASURY = process.env.TREASURY_ADDRESS;
const MOCK = pump.MOCK;

for (const k of MOCK ? [] : ['HELIUS_RPC_URL', 'PINATA_JWT', 'TREASURY_ADDRESS'])
  if (!process.env[k]) console.error(`[config] missing ${k}`);
if (MOCK) console.warn('[config] MOCK_CHAIN=1: chain and Pinata calls are faked');

const prepared = new Map(); // mint -> { creator, at }  (coins we built a launch for)
setInterval(() => { for (const [m, v] of prepared) if (Date.now() - v.at > 30 * 60e3) prepared.delete(m); }, 60e3).unref();

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json' : 'text/plain', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};
const ip = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function readJson(req, max = 3.6e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
  });
}

const publicCoin = (c) => ({ mint: c.mint, name: c.name, symbol: c.symbol, creator: c.creator, image: `/img/${c.mint}`, status: c.status, createdAt: c.createdAt, pump: `https://pump.fun/coin/${c.mint}` });

async function lockAndList(mint, creator) {
  const v = await pump.verifyLocked({ mint, creator, treasury: TREASURY });
  const status = v.ok ? 'locked' : 'created';
  store.upsertCoin({ mint, status, verifyNote: v.ok ? undefined : v.reason });
  return { ok: v.ok, status, reason: v.reason };
}

async function relayChecked(txs, creator) {
  if (!Array.isArray(txs) || !txs.length || txs.length > 2 || txs.some((t) => typeof t !== 'string' || t.length > 4000))
    throw Object.assign(new Error('Bad transactions'), { status: 400 });
  for (const t of txs) { const payer = await pump.feePayerOf(t); if (payer && payer !== creator) throw Object.assign(new Error('Wallet mismatch'), { status: 400 }); }
  return pump.relay(txs);
}

const routes = {
  'GET /api/config': async () => ({ treasury: TREASURY, creatorBps: pump.CREATOR_BPS, treasuryBps: pump.TREASURY_BPS, mock: MOCK }),
  'GET /api/coins': async () => ({ coins: store.listCoins().map(publicCoin) }),

  'POST /api/launch/prepare': async (req) => {
    if (limited('prep:' + ip(req), 6, 3600e3)) throw Object.assign(new Error('Too many launches from this connection. Try again later.'), { status: 429 });
    const p = parseLaunch(await readJson(req));
    if (!p.ok) throw Object.assign(new Error('Check the form.'), { status: 422, errors: p.errors });
    const v = p.value;
    if (limited('prepw:' + v.creator, 20, 24 * 3600e3)) throw Object.assign(new Error('Daily launch limit reached for this wallet.'), { status: 429 });

    let imageUrl, uri;
    if (MOCK) { imageUrl = 'mock://image'; uri = 'mock://metadata'; }
    else {
      imageUrl = await pinata.pinImage(v.image.buf, v.image.mime, `${v.symbol}.${v.image.ext}`);
      uri = await pinata.pinMetadata({ name: v.name, symbol: v.symbol, description: v.description, image: imageUrl, showName: true, createdOn: 'https://pump.fun',
        ...(v.twitter && { twitter: v.twitter }), ...(v.telegram && { telegram: v.telegram }), ...(v.website && { website: v.website }) }, `${v.symbol}-metadata`);
    }
    const built = await pump.buildLaunch({ creator: v.creator, name: v.name, symbol: v.symbol, uri, treasury: TREASURY });
    fs.writeFileSync(path.join(store.dataDir, 'img', built.mint), v.image.buf);
    fs.writeFileSync(path.join(store.dataDir, 'img', built.mint + '.type'), v.image.mime);
    prepared.set(built.mint, { creator: v.creator, at: Date.now() });
    store.upsertCoin({ mint: built.mint, name: v.name, symbol: v.symbol, description: v.description, creator: v.creator, uri, imageUrl,
      twitter: v.twitter, telegram: v.telegram, website: v.website, status: 'prepared', createdAt: Date.now() });
    return { mint: built.mint, txs: built.txs, buySol: v.buySol };
  },

  // Relay the user's signed launch transactions, then check the fee lock on chain.
  'POST /api/launch/send': async (req) => {
    const b = await readJson(req, 64e3);
    if (!isPubkey(b.creator) || !prepared.has(b.mint) || prepared.get(b.mint).creator !== b.creator) throw Object.assign(new Error('Unknown launch. Start again.'), { status: 400 });
    if (limited('send:' + ip(req), 30, 3600e3)) throw Object.assign(new Error('Too many requests.'), { status: 429 });
    let signatures;
    try { signatures = await relayChecked(b.txs, b.creator); }
    catch (e) { e.status = e.status || 502; throw e; }
    store.upsertCoin({ mint: b.mint, status: 'created', signatures });
    const r = await lockAndList(b.mint, b.creator);
    return { signatures, ...r };
  },

  // Coin exists but the fee lock did not land: build just the lock again.
  'POST /api/launch/finish': async (req) => {
    const b = await readJson(req, 4e3);
    const coin = isPubkey(b.mint) && store.getCoin(b.mint);
    if (!coin || coin.creator !== b.creator || coin.status === 'locked') throw Object.assign(new Error('Nothing to finish for this coin.'), { status: 400 });
    prepared.set(b.mint, { creator: b.creator, at: Date.now() });
    const r = await pump.buildLock({ creator: b.creator, mint: b.mint, treasury: TREASURY });
    return { mint: b.mint, txs: r.txs };
  },

  'POST /api/launch/buy': async (req) => {
    const b = await readJson(req, 4e3);
    const coin = isPubkey(b.mint) && store.getCoin(b.mint);
    const sol = Number(b.sol);
    if (!coin || coin.creator !== b.creator || coin.status !== 'locked' || !(sol > 0 && sol <= 10)) throw Object.assign(new Error('Cannot buy this coin yet.'), { status: 400 });
    prepared.set(b.mint, { creator: b.creator, at: Date.now() });
    return pump.buildBuy({ creator: b.creator, mint: b.mint, sol });
  },
  'POST /api/launch/send-buy': async (req) => {
    const b = await readJson(req, 16e3);
    if (!isPubkey(b.creator) || !prepared.has(b.mint) || prepared.get(b.mint).creator !== b.creator) throw Object.assign(new Error('Unknown request.'), { status: 400 });
    return { signatures: await relayChecked(b.txs, b.creator) };
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const key = `${req.method} ${u.pathname}`;
    if (routes[key]) return send(res, 200, await routes[key](req));
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    if (u.pathname.startsWith('/img/')) {
      const mint = u.pathname.slice(5);
      if (!isPubkey(mint) && !/^[0-9a-f]{40}pump$/.test(mint)) return send(res, 404, 'Not found');
      const f = path.join(store.dataDir, 'img', mint);
      if (!fs.existsSync(f)) return send(res, 404, 'Not found');
      return send(res, 200, fs.readFileSync(f), { 'Content-Type': fs.readFileSync(f + '.type', 'utf8'), 'Cache-Control': 'public, max-age=86400' });
    }
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found');
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[error]', req.method, req.url, e.message);
    send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong. Try again.' : e.message, errors: e.errors });
  }
});

server.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
  if (!MOCK && process.env.HELIUS_RPC_URL) pump.sdkReport().then((r) => console.log('[sdk]', JSON.stringify(r))).catch((e) => console.error('[sdk] load failed:', String(e.message).slice(0, 300)));
});
