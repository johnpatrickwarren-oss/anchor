import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  testGate, composeGates, grillingGate, runRound, MockRuntimeAdapter, MemorialStore, MemoryPersistence,
} from '../src/index.ts';
import type { RoundConfig, RoleResult } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29' };
const phase = (role: RoleResult['role']): RoleResult =>
  ({ role, status: 'READY', artifacts: [], handoff: {}, usage: { input: 0, cache_creation: 0, cache_read: 0, output: 0 } });

test('testGate: green suite passes; red suite blocks (after the implementer)', async () => {
  const green = testGate({ run: () => true });
  const red = testGate({ run: () => false });
  assert.equal((await green(phase('implementer'), cfg)).pass, true);
  const r = await red(phase('implementer'), cfg);
  assert.equal(r.pass, false);
  assert.match(r.findings![0], /red/i);
});

test('testGate: default fires only after the implementer (reviewer/architect/memorial pass through)', async () => {
  const red = testGate({ run: () => false }); // would block if it ran
  assert.equal((await red(phase('architect'), cfg)).pass, true);
  assert.equal((await red(phase('memorial'), cfg)).pass, true);
  assert.equal((await red(phase('reviewer'), cfg)).pass, true); // reviewer is read-only → not re-checked
  assert.equal((await red(phase('implementer'), cfg)).pass, false); // the implementer is the one gated
});

test('testGate: explicit roles can opt the reviewer back in (belt-and-suspenders)', async () => {
  const red = testGate({ run: () => false, roles: ['implementer', 'reviewer'] });
  assert.equal((await red(phase('reviewer'), cfg)).pass, false);
});

test('testGate: accrues confirmation on green, violation on red', async () => {
  const store = new MemorialStore(new MemoryPersistence());
  store.add({ id: 'tests-pass', trigger: 't', rule: 'r', origin: 'o' });
  await testGate({ run: () => true, accrual: { sink: store, memorialId: 'tests-pass' } })(phase('implementer'), cfg);
  await testGate({ run: () => false, accrual: { sink: store, memorialId: 'tests-pass' } })(phase('implementer'), cfg);
  const e = store.list()[0];
  assert.equal(e.cCount, 1);
  assert.equal(e.vCount, 1);
});

test('engine: a red test gate BLOCKS the round at the implementer (no COMPLETE over red)', async () => {
  const adapter = new MockRuntimeAdapter(); // all roles READY
  const r = await runRound({ ...cfg, tier: 'full' }, { adapter, gates: composeGates(testGate({ run: () => false })) });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'implementer'); // blocked at the first code-producing role
});

test('engine: a green test gate lets the round COMPLETE', async () => {
  const adapter = new MockRuntimeAdapter();
  const r = await runRound({ ...cfg, tier: 'full' }, { adapter, gates: composeGates(grillingGate(), testGate({ run: () => true })) });
  assert.equal(r.status, 'COMPLETE');
});
