// Prints what the installed pump SDK offers, so lib/pump.js can be matched to the real API.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('node_modules/@pump-fun/pump-sdk');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
console.log('[sdk] version', pkg.version, 'types', pkg.types || pkg.typings);
try { const mod = await import('@pump-fun/pump-sdk'); console.log('[sdk] exports:', Object.keys(mod).join(', ')); } catch (e) { console.log('[sdk] import failed:', String(e.message).slice(0, 300)); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const names = /createV2Instruction|createFeeSharingConfig|updateFeeSharesV2|feeSharingConfigPda|SharingConfig|decodeSharingConfig|class PumpSdk|class OnlinePumpSdk/;
for (const f of walk(root).filter((f) => f.endsWith('.d.ts'))) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => { if (names.test(l)) console.log(`[sdk] ${path.relative(root, f)}:${i + 1}: ${lines.slice(i, i + 12).join(' ').replace(/\s+/g, ' ').slice(0, 600)}`); });
}
