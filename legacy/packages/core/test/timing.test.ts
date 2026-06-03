import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRound, MockRuntimeAdapter } from '../src/index.ts';
import type { RoundConfig, RoleResult, GateOutcome } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29' };

test('timing: each phase records durationMs from the injected clock', async () => {
  let t = 0;
  const now = () => (t += 1000); // every clock() call advances 1000ms
  const r = await runRound({ ...cfg }, { adapter: new MockRuntimeAdapter(), now });
  assert.equal(r.phases.length, 4); // architect, implementer, reviewer, memorial
  for (const p of r.phases) assert.equal(p.durationMs, 1000); // t0 then push = one 1000ms tick each
});

test('timing: the default clock (Date.now) yields a numeric, non-negative duration', async () => {
  const r = await runRound({ ...cfg, tier: 'solo' }, { adapter: new MockRuntimeAdapter() });
  assert.equal(typeof r.phases[0].durationMs, 'number');
  assert.ok((r.phases[0].durationMs ?? -1) >= 0);
});

test('timing: each remediation attempt is timed as its own phase', async () => {
  let t = 0;
  const now = () => (t += 100);
  let calls = 0;
  const gate = (res: RoleResult): GateOutcome =>
    res.role === 'implementer' ? { pass: ++calls >= 3, findings: calls < 3 ? ['red'] : [] } : { pass: true, findings: [] };
  const r = await runRound({ ...cfg }, { adapter: new MockRuntimeAdapter(), gates: gate, maxFixAttempts: 2, now });
  const impl = r.phases.filter((p) => p.role === 'implementer');
  assert.equal(impl.length, 3); // initial + 2 remediation attempts
  for (const p of impl) assert.equal(typeof p.durationMs, 'number'); // each independently timed
});
