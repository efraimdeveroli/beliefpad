// Runs the whole API flow against the mock chain. Start with: npm test
import { spawn } from 'node:child_process';
const port = 4789;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: port, MOCK_CHAIN: '1', TREASURY_ADDRESS: 'EbW2sAyL1kWfBs9exwAgLuDQgVw5325KivYxsFnpxWMd', DATA_DIR: '/tmp/bp-smoke' }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const call = async (m, p, b) => { const r = await fetch(`http://localhost:${port}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const creator = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
let fails = 0; const t = (n, ok) => { console.log(ok ? 'PASS' : 'FAIL', n); if (!ok) fails++; };
try {
  t('config', (await call('GET', '/api/config')).j.creatorBps === 7000);
  t('rejects bad form', (await call('POST', '/api/launch/prepare', { name: '', symbol: 'a b', creator: 'x' })).s === 422);
  const bad = await call('POST', '/api/launch/prepare', { name: 'Test', symbol: 'tst', creator, image: 'data:image/png;base64,AAAA' });
  t('rejects non-image', bad.s === 422 && bad.j.errors.image);
  const prep = await call('POST', '/api/launch/prepare', { name: 'Test Coin', symbol: 'tst', description: 'hi', twitter: 'x.com/foo', creator, image: png, buySol: 0.5 });
  t('prepare ok', prep.s === 200 && prep.j.txs.length >= 1 && prep.j.mint);
  t('send rejects unknown mint', (await call('POST', '/api/launch/send', { mint: 'nope', creator, txs: ['AA'] })).s === 400);
  const sent = await call('POST', '/api/launch/send', { mint: prep.j.mint, creator, txs: prep.j.txs });
  t('send + verify -> locked', sent.s === 200 && sent.j.status === 'locked');
  const list = await call('GET', '/api/coins');
  t('coin listed', list.j.coins.some((c) => c.mint === prep.j.mint && c.symbol === 'TST'));
  const img = await fetch(`http://localhost:${port}/img/${prep.j.mint}`); t('image served', img.status === 200 && img.headers.get('content-type') === 'image/png');
  t('wrong creator cannot finish', (await call('POST', '/api/launch/finish', { mint: prep.j.mint, creator: 'EbW2sAyL1kWfBs9exwAgLuDQgVw5325KivYxsFnpxWMd' })).s === 400);
  const buy = await call('POST', '/api/launch/buy', { mint: prep.j.mint, creator, sol: 0.5 }); t('buy tx built', buy.s === 200);
  const bd = (await call('GET', '/api/board')).j; t('new coin on board at once', bd.coins.some((c) => c.mint === prep.j.mint && c.ranked === false));
  t('board shape', bd && Array.isArray(bd.coins) && Array.isArray(bd.warming) && typeof bd.nextSnapshotAt === 'number');
  t('path traversal blocked', (await fetch(`http://localhost:${port}/..%2f..%2fetc/passwd`)).status === 404);
} finally { srv.kill(); }
process.exit(fails ? 1 : 0);
