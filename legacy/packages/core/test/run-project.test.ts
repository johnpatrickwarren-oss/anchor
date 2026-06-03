import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockRuntimeAdapter } from '../src/runtime-adapter.ts';
import { decompose, runProject } from '../src/project/run-project.ts';
import type { Feature, Stage } from '../src/project/index.ts';
import type { WaveResult } from '../src/wave.ts';

// ── decompose: Coordinator role → features ──
test('decompose runs the coordinator and returns features from handoff.features', async () => {
  const adapter = new MockRuntimeAdapter({
    handler: (spec) => {
      assert.equal(spec.role, 'coordinator', 'decompose spawns the coordinator role');
      assert.match(spec.prompt, /ANCHOR-FEATURE/, 'prompt instructs the parseable format');
      return { handoff: { features: [
        { id: 'auth', directive: 'login', dependsOn: [] },
        { id: 'api', directive: 'endpoints', dependsOn: ['auth'] },
      ] } };
    },
  });
  const features = await decompose(adapter, 'build a small app');
  assert.equal(features.length, 2);
  assert.deepEqual(features[1], { id: 'api', directive: 'endpoints', dependsOn: ['auth'] });
});

test('decompose falls back to parsing a raw-text handoff and normalizes shape', async () => {
  const adapter = new MockRuntimeAdapter({
    handler: () => ({ handoff: { features: 'ANCHOR-FEATURE [x]: do x\nANCHOR-FEATURE [y] deps=[x]: do y' } }),
  });
  const features = await decompose(adapter, 'p');
  assert.deepEqual(features.map((f) => f.id), ['x', 'y']);
  assert.deepEqual(features[1].dependsOn, ['x']);
});

test('decompose throws when the coordinator produces no parseable plan', async () => {
  const adapter = new MockRuntimeAdapter({ handler: () => ({ handoff: {} }) });
  await assert.rejects(decompose(adapter, 'p'), /no parseable ANCHOR-FEATURE plan/);
});

// ── runProject: staged sequencing via an injected runStage ──
const COMPLETE = (ids: string[]): WaveResult => ({
  waveId: 'w', status: 'COMPLETE',
  rounds: ids.map((id) => ({ itemId: id, result: { roundId: id, tier: 'audit', status: 'COMPLETE', phases: [], warnings: [], CAVEAT: '' } })),
});
const PARTIAL = (ids: string[]): WaveResult => ({ ...COMPLETE(ids), status: 'PARTIAL' });

test('runProject runs one stage per dependency level, in order, and reports COMPLETE', async () => {
  const features: Feature[] = [
    { id: 'auth', directive: 'a', dependsOn: [] },
    { id: 'logging', directive: 'b', dependsOn: [] },
    { id: 'api', directive: 'c', dependsOn: ['auth'] },
    { id: 'ui', directive: 'd', dependsOn: ['api', 'logging'] },
  ];
  const seen: string[][] = [];
  const runStage = async (stage: Stage) => { const ids = stage.map((f) => f.id); seen.push(ids); return COMPLETE(ids); };
  const r = await runProject(features, runStage, { projectId: 'P1' });
  assert.equal(r.status, 'COMPLETE');
  assert.deepEqual(seen, [['auth', 'logging'], ['api'], ['ui']]); // staged, concurrent within a stage
  assert.equal(r.stages.length, 3);
  assert.deepEqual(r.skipped, []);
});

test('runProject stops at a failed stage and reports downstream features as skipped', async () => {
  const features: Feature[] = [
    { id: 'auth', directive: 'a', dependsOn: [] },
    { id: 'api', directive: 'c', dependsOn: ['auth'] },
    { id: 'ui', directive: 'd', dependsOn: ['api'] },
  ];
  let launched = 0;
  const runStage = async (stage: Stage, i: number) => {
    launched++;
    return i === 0 ? PARTIAL(stage.map((f) => f.id)) : COMPLETE(stage.map((f) => f.id));
  };
  const r = await runProject(features, runStage, { projectId: 'P2' });
  assert.equal(r.status, 'PARTIAL');
  assert.equal(launched, 1, 'later stages are NOT launched after a failure');
  assert.deepEqual(r.skipped, ['api', 'ui']); // both downstream features reported as skipped
});
