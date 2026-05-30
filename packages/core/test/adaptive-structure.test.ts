import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptRolesForRisk, selectRiskLevel, runRoundFromDirective, MockRuntimeAdapter } from '../src/index.ts';
import type { Role } from '../src/index.ts';

const reviewers = (rs: { role: string }[]) => rs.filter((r) => r.role === 'reviewer').length;

test('selectRiskLevel: load-bearing (engine/) → high; routine → normal', () => {
  assert.equal(selectRiskLevel('refactor packages/core/src/engine/ internals'), 'high');
  assert.equal(selectRiskLevel('introduces A2 (new architectural pattern)'), 'high');
  assert.equal(selectRiskLevel('add a --json flag to the list command'), 'normal');
});

test('adaptRolesForRisk: high inserts a second reviewer after the first; normal is untouched', () => {
  const full: Role[] = ['architect', 'implementer', 'reviewer', 'memorial'];
  assert.deepEqual(adaptRolesForRisk(full, 'high'), ['architect', 'implementer', 'reviewer', 'reviewer', 'memorial']);
  assert.deepEqual(adaptRolesForRisk(full, 'normal'), full);
});

test('adaptRolesForRisk: a cycle with no reviewer is left alone (nothing to double-check)', () => {
  const solo: Role[] = ['implementer'];
  assert.deepEqual(adaptRolesForRisk(solo, 'high'), solo);
});

test('adaptRolesForRisk: returns a copy (no mutation of the input)', () => {
  const full: Role[] = ['architect', 'implementer', 'reviewer', 'memorial'];
  const out = adaptRolesForRisk(full, 'high');
  assert.notEqual(out, full);
  assert.equal(full.length, 4); // input unchanged
});

test('runRoundFromDirective: a high-risk directive runs TWO reviewer passes', async () => {
  const adapter = new MockRuntimeAdapter();
  const r = await runRoundFromDirective('rework packages/core/src/engine/ sequencing', { adapter }, {
    roundId: 'R01', runDate: '2026-05-29', tierOverride: 'full',
  });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(reviewers(r.phases), 2); // second cold-eye pass for the load-bearing change
});

test('runRoundFromDirective: riskAdapt:false opts out (single reviewer even for high risk)', async () => {
  const adapter = new MockRuntimeAdapter();
  const r = await runRoundFromDirective('rework packages/core/src/engine/ sequencing', { adapter }, {
    roundId: 'R01', runDate: '2026-05-29', tierOverride: 'full', riskAdapt: false,
  });
  assert.equal(reviewers(r.phases), 1);
});

test('runRoundFromDirective: a routine directive keeps the single-reviewer cycle', async () => {
  const adapter = new MockRuntimeAdapter();
  const r = await runRoundFromDirective('add a --json flag to list', { adapter }, {
    roundId: 'R01', runDate: '2026-05-29', tierOverride: 'full',
  });
  assert.equal(reviewers(r.phases), 1);
});
