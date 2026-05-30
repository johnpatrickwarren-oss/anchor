import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRound, MockRuntimeAdapter } from '../src/index.ts';
import type { RoundConfig, RoleResult, GateOutcome } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29' };
const implPhases = (r: { phases: { role: string }[] }) => r.phases.filter((p) => p.role === 'implementer');

test('remediation: a red gate that goes green on retry → COMPLETE, with an extra implementer phase', async () => {
  const adapter = new MockRuntimeAdapter();
  let calls = 0;
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'implementer' ? { pass: ++calls >= 2, findings: calls < 2 ? ['test suite is RED'] : [] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter, gates: gate, maxFixAttempts: 2 });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(implPhases(r).length, 2); // initial + 1 fix attempt
});

test('remediation: a persistently red gate BLOCKS after maxFixAttempts, recording each attempt', async () => {
  const adapter = new MockRuntimeAdapter();
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'implementer' ? { pass: false, findings: ['still red'] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter, gates: gate, maxFixAttempts: 2 });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'implementer');
  assert.equal(implPhases(r).length, 3); // initial + 2 fix attempts
});

test('remediation: maxFixAttempts=0 disables the loop (block on the first red)', async () => {
  const adapter = new MockRuntimeAdapter();
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'implementer' ? { pass: false, findings: ['red'] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter, gates: gate, maxFixAttempts: 0 });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(implPhases(r).length, 1); // no retry
});

test('remediation: only the implementer remediates — an architect gate failure blocks with no retry', async () => {
  const adapter = new MockRuntimeAdapter();
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'architect' ? { pass: false, findings: ['arch red'] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter, gates: gate, maxFixAttempts: 2 });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'architect');
  assert.equal(r.phases.filter((p) => p.role === 'architect').length, 1); // structural, not remediable
});

test('remediation: the re-run prompt feeds the gate findings back to the implementer', async () => {
  const prompts: string[] = [];
  const adapter = new MockRuntimeAdapter({ handler: (spec) => { if (spec.role === 'implementer') prompts.push(spec.prompt); return {}; } });
  let calls = 0;
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'implementer' ? { pass: ++calls >= 2, findings: calls < 2 ? ['epsilon off-by-one at foo.ts:42'] : [] } : { pass: true, findings: [] };
  await runRound({ ...cfg }, { adapter, gates: gate, maxFixAttempts: 2 });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /REMEDIATION/);
  assert.match(prompts[1], /epsilon off-by-one at foo\.ts:42/); // the finding is fed back verbatim
});

test('remediation: default (no maxFixAttempts set) allows 2 fix attempts', async () => {
  const adapter = new MockRuntimeAdapter();
  const gate = (r: RoleResult): GateOutcome =>
    r.role === 'implementer' ? { pass: false, findings: ['red'] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter, gates: gate }); // default
  assert.equal(r.status, 'BLOCKED');
  assert.equal(implPhases(r).length, 3); // initial + default 2 fix attempts
});
