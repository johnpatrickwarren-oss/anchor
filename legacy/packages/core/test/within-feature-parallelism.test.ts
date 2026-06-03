import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRound, MockRuntimeAdapter } from '../src/index.ts';
import type { RoundConfig, RoleResult, ImplUnit } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29' };
const UNITS: ImplUnit[] = [{ id: 'a', scope: 'owns src/a.ts' }, { id: 'b', scope: 'owns src/b.ts' }];
const implPhases = (r: { phases: { role: string }[] }) => r.phases.filter((p) => p.role === 'implementer');

// A handler that counts implementer spawns and tags each unit's artifact from its prompt.
function tracking() {
  const implPrompts: string[] = [];
  const adapter = new MockRuntimeAdapter({
    handler: (spec) => {
      if (spec.role !== 'implementer') return {};
      implPrompts.push(spec.prompt);
      const m = spec.prompt.match(/PARALLEL UNIT \[(\w+)\]/);
      return m ? { artifacts: [`src/${m[1]}.ts`] } : {};
    },
  });
  return { adapter, implPrompts };
}

test('parallelism: ≥2 pre-set units fan out — one sub-implementer per unit, merged into one phase', async () => {
  const { adapter, implPrompts } = tracking();
  const r = await runRound({ ...cfg, units: UNITS }, { adapter });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implPrompts.length, 2); // two concurrent sub-implementers
  assert.match(implPrompts[0], /PARALLEL UNIT \[a\]/);
  assert.match(implPrompts[1], /PARALLEL UNIT \[b\]/);
  assert.equal(implPhases(r).length, 1); // merged into a single implementer phase
  assert.deepEqual(implPhases(r)[0].artifacts, ['src/a.ts', 'src/b.ts']); // all units' artifacts
});

test('parallelism: the merged implementer phase sums usage across units', async () => {
  const { adapter } = tracking();
  const r = await runRound({ ...cfg, units: UNITS }, { adapter });
  // default mock usage per call = {10,100,200,50}; two units → doubled.
  assert.deepEqual(implPhases(r)[0].usage, { input: 20, cache_creation: 200, cache_read: 400, output: 100 });
});

test('parallelism: the Architect can DECLARE units (handoff.units) → the implementer fans out', async () => {
  const implPrompts: string[] = [];
  const adapter = new MockRuntimeAdapter({
    handler: (spec) => {
      if (spec.role === 'architect') return { handoff: { units: [{ id: 'x', scope: 'sx' }, { id: 'y', scope: 'sy' }] } };
      if (spec.role === 'implementer') implPrompts.push(spec.prompt);
      return {};
    },
  });
  const r = await runRound({ ...cfg }, { adapter }); // no pre-set units; architect declares them
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implPrompts.length, 2);
  assert.match(implPrompts[1], /PARALLEL UNIT \[y\]/);
});

test('parallelism: any unit BLOCKED → merged implementer BLOCKED → round BLOCKED', async () => {
  const adapter = new MockRuntimeAdapter({
    handler: (spec) => (spec.role === 'implementer' && /\[b\]/.test(spec.prompt) ? { status: 'BLOCKED' } : {}),
  });
  const r = await runRound({ ...cfg, units: UNITS }, { adapter });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'implementer');
});

test('parallelism: a single unit does NOT fan out (no parallelism benefit)', async () => {
  const { adapter, implPrompts } = tracking();
  const r = await runRound({ ...cfg, units: [{ id: 'solo', scope: 'all' }] }, { adapter });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implPrompts.length, 1);
  assert.doesNotMatch(implPrompts[0], /PARALLEL UNIT/); // ran the normal serial implementer
});

test('parallelism: no units → the normal single implementer (unchanged path)', async () => {
  const { adapter, implPrompts } = tracking();
  const r = await runRound({ ...cfg }, { adapter });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implPrompts.length, 1);
  assert.doesNotMatch(implPrompts[0], /PARALLEL UNIT/);
});

test('parallelism: remediation after a fan-out re-runs a single integrative fixer (not the units)', async () => {
  let implCalls = 0;
  const adapter = new MockRuntimeAdapter({ handler: (spec) => { if (spec.role === 'implementer') implCalls++; return {}; } });
  let gateCalls = 0;
  const gate = (res: RoleResult) =>
    res.role === 'implementer' ? { pass: ++gateCalls >= 2, findings: gateCalls < 2 ? ['red'] : [] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg, units: UNITS }, { adapter, gates: gate, maxFixAttempts: 2 });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implCalls, 3); // 2 fan-out sub-implementers + 1 integrative remediation
  assert.equal(implPhases(r).length, 2); // merged fan-out phase + the fix phase
});
