// Tiny JSON-file store. Point DATA_DIR at a Railway volume so it survives deploys.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DIR, 'coins.json');
fs.mkdirSync(path.join(DIR, 'img'), { recursive: true });

let coins = [];
try { coins = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { coins = []; }

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(coins));
  fs.renameSync(tmp, FILE);
}

export const dataDir = DIR;
export const getCoin = (mint) => coins.find((c) => c.mint === mint);
export const listCoins = ({ status = 'locked', limit = 100 } = {}) =>
  coins.filter((c) => !status || c.status === status).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
export function upsertCoin(c) {
  const i = coins.findIndex((x) => x.mint === c.mint);
  if (i >= 0) coins[i] = { ...coins[i], ...c }; else coins.push(c);
  save();
  return getCoin(c.mint);
}

// ---- Belief tracking state (wallet hold clocks and snapshot history), kept apart from the coin list
const SFILE = path.join(DIR, 'belief-state.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(SFILE, 'utf8')); } catch { state = {}; }
export const coinState = (mint) => (state[mint] ||= { wallets: {}, owners: {}, snaps: [], market: null });
export function saveState() {
  const tmp = SFILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, SFILE);
}
