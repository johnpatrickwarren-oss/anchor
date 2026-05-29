import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockRuntimeAdapter, MemoryPersistence } from '@anchor/core';
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

test('run without --mock and no API key fails preflight (code 2)', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { ctx, out } = testCtx();
    const r = await cmdRun({ tier: 'audit', task: 'demo' }, ctx);
    assert.equal(r.code, 2);
    assert.match(out.join('\n'), /ANTHROPIC_API_KEY/);
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

test('memorial unknown subcommand errors', async () => {
  const { ctx } = testCtx();
  assert.equal((await cmdMemorial('frobnicate', {}, ctx)).code, 2);
});
