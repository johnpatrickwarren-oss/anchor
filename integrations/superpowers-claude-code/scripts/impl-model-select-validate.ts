// scripts/impl-model-select-validate.ts — load-bearing safety check for impl-model-select.
// Runs every case in impl-model-select-fixtures/corpus.json through the selector and
// asserts model_class + model match. Exit 0 = all pass; exit 1 = any mismatch.
// Mirrors tier-router-validate.ts. Re-run after any model bump or marker change, and
// before adopting a new model into scripts/models.json.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'impl-model-select-fixtures');
const selector = join(here, 'impl-model-select.ts');

interface Case { fixture: string; tier: string; expect_class: string; expect_model: string; }

const corpus: Case[] = JSON.parse(readFileSync(join(fixturesDir, 'corpus.json'), 'utf-8'));
let pass = 0;
const failures: string[] = [];

for (const c of corpus) {
  const out = JSON.parse(
    execFileSync('node', [selector, '--directive', join(fixturesDir, c.fixture), '--tier', c.tier], { encoding: 'utf-8' }),
  );
  const ok = out.model_class === c.expect_class && out.model === c.expect_model;
  if (ok) { pass++; }
  else { failures.push(`${c.fixture} @${c.tier}: got ${out.model_class}/${out.model}, expected ${c.expect_class}/${c.expect_model}`); }
}

if (failures.length) {
  process.stderr.write(`impl-model-select-validate: ${failures.length} FAILURE(S)\n` + failures.map(f => `  - ${f}`).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write(`impl-model-select-validate: ${pass}/${corpus.length} corpus cases pass\n`);
process.exit(0);
