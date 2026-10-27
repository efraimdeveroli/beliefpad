// Prints what the installed pump SDK offers, so lib/pump.js can be matched to the real API.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('node_modules/@pump-fun/pump-sdk');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
console.log('[sdk] version', pkg.version, 'main', pkg.main, 'module', pkg.module, 'exports', JSON.stringify(pkg.exports).slice(0, 400), 'deps', JSON.stringify(pkg.dependencies));
import { createRequire } from 'node:module';
try { const m = createRequire(import.meta.url)('@pump-fun/pump-sdk'); console.log('[sdk] require ok, PumpSdk:', typeof m.PumpSdk, 'isSharingConfigEditable:', typeof m.isSharingConfigEditable, 'feeSharingConfigPda:', typeof m.feeSharingConfigPda); } catch (e) { console.log('[sdk] require failed:', String(e.message).slice(0, 300)); }
try { const mod = await import('@pump-fun/pump-sdk'); console.log('[sdk] exports:', Object.keys(mod).join(', ')); } catch (e) { console.log('[sdk] import failed:', String(e.message).slice(0, 300)); }
