#!/usr/bin/env node
// Post-build: rewrite relative `.ts` import/export specifiers to `.js` inside emitted .d.ts files.
//
// Why: tsc's `rewriteRelativeImportExtensions` rewrites the .js emit (so the runtime resolves
// `./x.js`), but it does NOT rewrite the .d.ts emit — those keep the source `./x.ts` specifiers.
// A consumer's TypeScript then fails to resolve `./x.ts` (it has no `allowImportingTsExtensions`).
// We only touch quoted RELATIVE specifiers ending in `.ts` (./… or ../…), so string literals and
// bare/package specifiers are left alone.
//
// Usage: node scripts/rewrite-dts-ext.mjs <distDir>
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: rewrite-dts-ext.mjs <distDir>'); process.exit(2); }

// Matches: from '<rel>.ts' | from "<rel>.ts" | import('<rel>.ts')  — rel starts with . (./ or ../)
const RE = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]*)\.ts(\2)/g;

let changed = 0, scanned = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.d.ts')) continue;
    scanned++;
    const before = readFileSync(p, 'utf8');
    const after = before.replace(RE, (_m, pre, q, spec, q2) => `${pre}${q}${spec}.js${q2}`);
    if (after !== before) { writeFileSync(p, after); changed++; }
  }
}
walk(root);
console.log(`rewrite-dts-ext: scanned ${scanned} .d.ts file(s), rewrote ${changed}`);
