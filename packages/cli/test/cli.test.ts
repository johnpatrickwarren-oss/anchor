import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockRuntimeAdapter, MemoryPersistence, MemorialStore, JsonFilePersistence } from '@anchor/core';
import type { MemorialEntry } from '@anchor/core';
import { parseArgs } from '../src/args.ts';
import { cmdRoute, cmdRun, cmdMemorial } from '../src/commands.ts';
import type { CliContext } from '../src/commands.ts';

function testCtx(seed: MemorialEntry[] = []) {
  const out: string[] = [];
  const persistence = new MemoryPersistence(seed);
  const ctx: CliContext = {
    cwd: '/tmp',
    now: () => '2026-05-29',
    stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter(),
    makePersistence: () => persistence,
  };
  return { ctx, out };
}

test('parseArgs handles --flag value, --flag=value, boolean, positionals', () => {
  const { _, flags } = parseArgs(['run', '--tier', 'audit', '--task=do x', '--mock']);
  assert.deepEqual(_, ['run']);
  assert.equal(flags.tier, 'audit');
  assert.equal(flags.task, 'do x');
  assert.equal(flags.mock, true);
});

test('route classifies a directive (offline)', async () => {
  const { ctx, out } = testCtx();
  const r = await cmdRoute({ task: 'Modify engine/detectors/fcp.ts — architectural-decision' }, ctx);
  assert.equal(r.code, 0);
  assert.equal(r.route!.tier, 'full');
  assert.match(out.join('\n'), /tier: full/);
});

test('route with no input errors (code 2)', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdRoute({}, ctx)).code, 2);
});

test('run --mock --tier audit runs the 3-role cycle', async () => {
  const { ctx } = testCtx();
  const r = await cmdRun({ mock: true, tier: 'audit', task: 'demo' }, ctx);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result!.phases.map((p) => p.role), ['implementer', 'reviewer', 'memorial']);
});

test('run --mock self-routes from --task when no --tier given', async () => {
  const { ctx } = testCtx();
  const r = await cmdRun({ mock: true, task: 'mechanical typo fix in the README' }, ctx);
  assert.equal(r.result!.tier, 'implementer-only');
  assert.deepEqual(r.result!.phases.map((p) => p.role), ['implementer']);
});

test('run without --mock and no API key does NOT hard-block (SDK uses Claude Code auth); prints a note', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { ctx, out } = testCtx(); // injects a mock adapter, so the run completes
    const r = await cmdRun({ tier: 'audit', task: 'demo' }, ctx);
    assert.equal(r.code, 0);
    assert.match(out.join('\n'), /no ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

const seedEntry: MemorialEntry = { id: 'firing-attribution', trigger: 'hypothesis tree', rule: 'verify attribution first', origin: 'DeploySignal T52', vCount: 0, cCount: 25, status: 'active' };

test('memorial list / ratios / prune', async () => {
  const { ctx, out } = testCtx([{ ...seedEntry }]);
  assert.equal((await cmdMemorial('list', {}, ctx)).code, 0);

  const ratios = await cmdMemorial('ratios', {}, ctx);
  assert.equal((ratios.data as { id: string }[])[0].id, 'firing-attribution');

  const pruned = await cmdMemorial('prune', {}, ctx);
  assert.deepEqual((pruned.data as { retired: string[] }).retired, ['firing-attribution']); // 25 C / 0 V -> retired
  assert.match(out.join('\n'), /retired: firing-attribution/);
});

test('run: structural gates default-ON as advisory; --strict promotes them to blocking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-cli-'));
  const specPath = join(dir, 'q-spec.md');
  writeFileSync(specPath, '# Spec for demo\nBody with no self-review buckets and no excluded-items list.\n'); // omits both disciplines (and avoids trigger words)
  const out: string[] = [];
  const ctx: CliContext = {
    cwd: dir,
    now: () => '2026-05-29',
    stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter({ handler: (spec) => (spec.role === 'architect' ? { artifacts: [specPath] } : {}) }),
    makePersistence: () => new MemoryPersistence(),
  };

  // default: advisory — run completes but the omissions surface as warnings
  const adv = await cmdRun({ tier: 'full', task: 'demo' }, ctx);
  assert.equal(adv.result!.status, 'COMPLETE');
  assert.ok(adv.result!.warnings.some((w) => /grilling/i.test(w)));
  assert.ok(adv.result!.warnings.some((w) => /anti-?scope/i.test(w)));

  // --strict: the same omissions now block the run
  const strict = await cmdRun({ tier: 'full', task: 'demo', strict: true }, ctx);
  assert.equal(strict.code, 1);
  assert.equal(strict.result!.status, 'BLOCKED');

  // --no-gates: omissions neither warn nor block
  const off = await cmdRun({ tier: 'full', task: 'demo', 'no-gates': true }, ctx);
  assert.equal(off.result!.status, 'COMPLETE');
  assert.equal(off.result!.warnings.length, 0);
});

test('run --memorial seeds disciplines and accrues V/C (violation on missing, confirmation on present)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-mem-run-'));
  const memPath = join(dir, 'memorial.json');
  const badSpec = join(dir, 'q-spec-bad.md'); writeFileSync(badSpec, '# Spec\nno self-review buckets, no excluded-items list');
  const goodSpec = join(dir, 'q-spec-good.md'); writeFileSync(goodSpec, '## Anti-scope\nNO ranges.\n## Pre-emit grilling\nCRITICAL: 0\nLIKELY-SURFACES: 0\nPRE-EMPTABLE: 0');
  const out: string[] = [];
  const ctx: CliContext = {
    cwd: dir, now: () => '2026-05-29', stdout: (s) => out.push(s),
    makeAdapter: () => new MockRuntimeAdapter(),
    makePersistence: (p) => new JsonFilePersistence(p!), // real file so the run persists + we can re-read
  };
  await cmdRun({ tier: 'full', task: 'demo', memorial: memPath, spec: badSpec }, ctx);   // missing grilling+anti-scope
  await cmdRun({ tier: 'full', task: 'demo', memorial: memPath, spec: goodSpec }, ctx);  // both present

  const store = new MemorialStore(new JsonFilePersistence(memPath));
  const grill = store.list().find((e) => e.id === 'pre-emit-grilling')!;
  const ascope = store.list().find((e) => e.id === 'anti-scope')!;
  assert.equal(grill.vCount, 1, 'grilling violation on the bad spec');
  assert.equal(grill.cCount, 1, 'grilling confirmation on the good spec');
  assert.equal(ascope.vCount, 1);
  assert.equal(ascope.cCount, 1);
});

test('memorial add authors a new entry', async () => {
  const { ctx } = testCtx();
  const r = await cmdMemorial('add', { id: 'my-rule', rule: 'always grep the field name', trigger: 'schema change' }, ctx);
  assert.equal(r.code, 0);
  assert.ok((r.data as { id: string }[]).some((e) => e.id === 'my-rule'));
  // missing --rule errors
  assert.equal((await cmdMemorial('add', { id: 'x' }, ctx)).code, 2);
});

test('memorial unknown subcommand errors', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdMemorial('frobnicate', {}, ctx)).code, 2);
});
