// Self-contained regression test for the oracle GATE's reference cross-check (no deps / no suite).
// Confirms the gate REJECTS the saved bad oracle — which has a known __proto__ false-positive —
// by cross-checking it against the known-good reference validator. This is the preserved, runnable
// proof that the gated harness would refuse the oracle that wasted ~5x cost in the first e2e run.
//
// Run:  node test-gate.mjs   (exit 0 = gate correctly detects the false-positive)
import { pathToFileURL } from 'node:url';

const ORACLE = new URL('./fixtures/bad-oracle-run.mjs', import.meta.url).pathname;
const REF = new URL('./fixtures/known-good-validator/index.ts', import.meta.url).pathname;

const m = await import(pathToFileURL(ORACLE).href);
const r = await m.grade(REF);
const fps = (r.failures || []).filter(Boolean);

console.log(`oracle vs known-good reference: ${r.pass}/${r.total}; false-positives: ${fps.length}`);
for (const f of fps) console.log('  -', JSON.stringify(f.case ?? f));

const ok = fps.length > 0;
console.log(ok
  ? 'PASS: reference cross-check detects the false-positive -> gate would REJECT this oracle (no fix-loop) ✅'
  : 'FAIL: gate did not detect the known false-positive');
process.exit(ok ? 0 : 1);
