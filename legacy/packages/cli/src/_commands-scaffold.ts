// @anchor/cli — greenfield scaffolding (`anchor init`) and the read-only drift report
// (`anchor calibrate`). init writes a minimal, green-from-round-1 project; calibrate reports
// whether the routing labels are still grounded against the API's current models.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute, basename, resolve } from 'node:path';
import { ROUTING_PROVENANCE, checkModelDrift } from '@anchor/core';
import { str, bool } from './args.ts';
import type { CliContext, Flags } from './_commands-shared.ts';

// ── anchor init ──
// Bootstrap an empty (or partial) directory into a greenfield project the green-test gate
// can run against from round 1. The gate runs `npm test`; on a truly empty repo there is no
// suite, so the gate would have nothing to gate on. init scaffolds a minimal package.json
// (test → `node --test`) plus a PASSING smoke test, so `npm test` is green out of the box and
// the Architect→Implementer cycle can layer real TDD tests on top. Idempotent and non-clobbering:
// an existing file is left untouched unless --force. Optional `git init` (--no-git to skip).
//
// Files scaffolded (skipped if present):
//   package.json            type:module + "test": "node --test"
//   test/smoke.test.js       a passing placeholder so the gate is green from round 1
//   coordination/PRD.md      the one artifact you author by hand; feed it via --directive
//   src/.gitkeep             keep an empty source dir under version control
//   .gitignore               node_modules/ + .anchor/
//   README.md                project stub pointing at the anchor run command
const PRD_TEMPLATE = (name: string) => `# PRD — ${name}

> The one artifact you author by hand. Anchor's roles read this as the directive:
>   anchor run --directive coordination/PRD.md
> Keep the round's scope tight — the anti-scope gate flags creep.

## Problem
<what are we building, and why>

## Scope (this round)
<the smallest shippable slice>

## Out of scope
<explicitly excluded — prevents scope drift>

## Acceptance
<how we know it works — these become tests>
`;
const SMOKE_TEST = `// Greenfield smoke test scaffolded by \`anchor init\`.
// It exists so \`npm test\` (Anchor's green-test gate) is green from round 1, before any real
// code is written. Your first real round should add real tests (TDD red-green); delete this
// once you have them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('greenfield scaffold: the test runner is wired up', () => {
  assert.ok(true);
});
`;
const PKG_JSON = (name: string) => JSON.stringify({
  name, version: '0.0.0', private: true, type: 'module',
  // `--import ./ts-resolve.mjs` lets multi-module TS written with NodeNext `./x.js` imports run
  // under type-stripping with NO build step (the resolver maps them to the `./x.ts` sibling).
  scripts: { test: 'node --import ./ts-resolve.mjs --test' },
}, null, 2) + '\n';
// In-thread module resolve hook (Node ≥24 module.registerHooks). Greenfield TS is multi-module,
// and models naturally write NodeNext imports (`import './parser.js'` for a parser.ts). Without a
// build step those don't resolve, breaking `node --test`. This maps a relative `.js` specifier to
// its `.ts` sibling when that exists — keeping the scaffold build-free yet import-convention-robust.
const TS_RESOLVE = `// Scaffolded by \`anchor init\`. Resolves NodeNext-style './x.js' imports to './x.ts' so
// multi-module TypeScript runs under \`node --test\` with no build step. Loaded via the test script.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\\.{1,2}\\//.test(specifier) && specifier.endsWith('.js')) {
      try { return nextResolve(specifier.slice(0, -3) + '.ts', context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});
`;
const README_STUB = (name: string) => `# ${name}

Greenfield project scaffolded by \`anchor init\`. Edit the PRD, then run a round:

    anchor run --directive coordination/PRD.md

\`npm test\` runs the suite Anchor's green-test gate gates on.
`;

export async function cmdInit(dir: string | undefined, flags: Flags, ctx: CliContext): Promise<{ code: number }> {
  const arg = dir ?? str(flags, 'cwd') ?? '.';
  const target = isAbsolute(arg) ? arg : resolve(ctx.cwd, arg);
  const name = basename(target) || 'anchor-project';
  const force = bool(flags, 'force');

  const files: Array<[string, string]> = [
    ['package.json', PKG_JSON(name)],
    ['ts-resolve.mjs', TS_RESOLVE],
    [join('test', 'smoke.test.js'), SMOKE_TEST],
    [join('coordination', 'PRD.md'), PRD_TEMPLATE(name)],
    [join('src', '.gitkeep'), ''],
    ['.gitignore', 'node_modules/\n.anchor/\n'],
    ['README.md', README_STUB(name)],
  ];
  const created: string[] = [];
  const skipped: string[] = [];
  try {
    for (const [rel, content] of files) {
      const abs = join(target, rel);
      if (existsSync(abs) && !force) { skipped.push(rel); continue; }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      created.push(rel);
    }
  } catch (e) {
    ctx.stdout(`error: could not scaffold into ${target}: ${(e as Error).message}`);
    return { code: 1 };
  }

  let gitNote = '';
  if (!bool(flags, 'no-git')) {
    if (existsSync(join(target, '.git'))) gitNote = '\ngit: repo already present — left as-is.';
    else {
      try { execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' }); gitNote = '\ngit: initialized an empty repository.'; }
      catch (e) { gitNote = `\ngit: skipped (\`git init\` failed: ${(e as Error).message}) — re-run \`git init\` yourself, or pass --no-git.`; }
    }
  }

  ctx.stdout(
    `scaffolded greenfield project "${name}" → ${target}\n` +
    `  created: ${created.join(', ') || '—'}\n` +
    `  skipped (already present; --force to overwrite): ${skipped.join(', ') || '—'}` +
    gitNote +
    `\n\nnext:\n  1. write your PRD → ${join(target, 'coordination', 'PRD.md')}\n` +
    `  2. run the first round → anchor run --directive coordination/PRD.md${target === ctx.cwd ? '' : ` --cwd ${target}`}\n` +
    `  (the smoke test keeps \`npm test\` green until your first real tests land.)`,
  );
  return { code: 0 };
}

// ── anchor calibrate ──
// Reports model drift: the API's current models vs the set the routing labels were grounded
// under. Read-only + cheap (no model tokens, no oracle grid). When it reports drift, the actual
// re-grounding is the deliberate, paid step: run the oracle grid (scripts/routing-oracle.mjs)
// against the benchmark corpus with the new model, then bump ROUTING_PROVENANCE. `anchor run`/
// `wave` already fail SAFE (over-provision) in the meantime — this command just makes the
// staleness explicit and tells you what to do about it.
export async function cmdCalibrate(flags: Flags, ctx: CliContext): Promise<{ code: number }> {
  if (!process.env.ANTHROPIC_API_KEY) { ctx.stdout('error: anchor calibrate needs ANTHROPIC_API_KEY to list models.'); return { code: 2 }; }
  let available: string[];
  try { available = await ctx.listModels(); }
  catch (e) { ctx.stdout(`error: could not list models: ${(e as Error).message}`); return { code: 1 }; }
  const drift = checkModelDrift(available);
  ctx.stdout(`routing labels grounded ${ROUTING_PROVENANCE.groundedDate} under: ${ROUTING_PROVENANCE.models.join(', ')}`);
  if (!drift.drifted) { ctx.stdout(`✓ no drift — all ${available.length} available model(s) are grounded. Routing labels are current.`); return { code: 0 }; }
  ctx.stdout(`⚠ drift: ${drift.newModels.length} ungrounded model(s): ${drift.newModels.join(', ')}`);
  ctx.stdout('  Until re-grounded, `anchor run`/`wave` route conservatively (full tier + opus) — safe, just pricier.');
  ctx.stdout('  To re-ground: run the oracle grid (scripts/routing-oracle.mjs) on the benchmark corpus with the new model,');
  ctx.stdout('  add its pricing, then bump ROUTING_PROVENANCE (models + groundedDate) and re-run the routing-accuracy harness.');
  return { code: 0 };
}
