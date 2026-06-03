import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRound, resumeRound, MockRuntimeAdapter } from '../src/index.ts';
import type { RoundConfig, RoleSpec, RoleResult } from '../src/index.ts';

const cfg = (tier: RoundConfig['tier']): RoundConfig => ({ roundId: 'R01', tier, task: 'demo', runDate: '2026-05-29' });
const roleOrder = (r: { phases: { role: string }[] }) => r.phases.map((p) => p.role);

test('full tier runs Architect->Implementer->Reviewer->Memorial in order', async () => {
  const r = await runRound(cfg('full'), { adapter: new MockRuntimeAdapter() });
  assert.equal(r.status, 'COMPLETE');
  assert.deepEqual(roleOrder(r), ['architect', 'implementer', 'reviewer', 'memorial']);
});

test('every role prompt carries the global engine-owns-verification note (no role self-verifies)', async () => {
  const prompts: Record<string, string> = {};
  const adapter = new MockRuntimeAdapter({ handler: (spec) => { prompts[spec.role] = spec.prompt; return {}; } });
  await runRound(cfg('full'), { adapter });
  for (const role of ['architect', 'implementer', 'reviewer', 'memorial']) {
    assert.match(prompts[role], /VERIFICATION & DISCIPLINES \(all roles\)/, `${role} missing the global note`);
    assert.match(prompts[role], /escalate to ask whether a discipline/i); // discipline-general, not just tests
  }
});

test('reinforcements inject into producing roles but NOT the memorial (it records, not produces)', async () => {
  const prompts: Record<string, string> = {};
  const adapter = new MockRuntimeAdapter({ handler: (spec) => { prompts[spec.role] = spec.prompt; return {}; } });
  const memorial = { applicable: async () => ['[anti-scope] every spec must carry an anti-scope section'], record: async () => {} };
  await runRound(cfg('full'), { adapter, memorial });
  assert.match(prompts.implementer, /REINFORCEMENTS/);          // producing role gets reminded
  assert.doesNotMatch(prompts.memorial, /REINFORCEMENTS/);      // recorder does not (no discipline to escalate over)
});

test('audit tier drops the Architect', async () => {
  const r = await runRound(cfg('audit'), { adapter: new MockRuntimeAdapter() });
  assert.deepEqual(roleOrder(r), ['implementer', 'reviewer', 'memorial']);
});

test('solo / implementer-only run the Implementer alone; coordinator-only runs the Coordinator', async () => {
  assert.deepEqual(roleOrder(await runRound(cfg('solo'), { adapter: new MockRuntimeAdapter() })), ['implementer']);
  assert.deepEqual(roleOrder(await runRound(cfg('implementer-only'), { adapter: new MockRuntimeAdapter() })), ['implementer']);
  assert.deepEqual(roleOrder(await runRound(cfg('coordinator-only'), { adapter: new MockRuntimeAdapter() })), ['coordinator']);
});

test('each role is dispatched on its routed model', async () => {
  const r = await runRound(cfg('full'), { adapter: new MockRuntimeAdapter() });
  const model = (role: string) => r.phases.find((p) => p.role === role)!.model;
  assert.equal(model('architect'), 'claude-opus-4-8');
  assert.equal(model('implementer'), 'claude-sonnet-4-6');
  assert.equal(model('reviewer'), 'claude-opus-4-8');
  assert.equal(model('memorial'), 'claude-haiku-4-5-20251001');
});

test('per-role model override wins (the dynamic-selector seam)', async () => {
  const r = await runRound(cfg('audit'), {
    adapter: new MockRuntimeAdapter(),
    modelOverrides: { implementer: 'claude-haiku-4-5-20251001' }, // e.g. mechanical round
  });
  assert.equal(r.phases.find((p) => p.role === 'implementer')!.model, 'claude-haiku-4-5-20251001');
});

// Stateful handler: escalate the first time a given role runs, READY thereafter.
function escalateOnce(role: string) {
  let seen = 0;
  return (spec: RoleSpec): Partial<RoleResult> => {
    if (spec.role === role && seen++ === 0) {
      return { status: 'ESCALATE', escalation: { question: 'A or B?', options: ['A', 'B'], raisedBy: spec.role } };
    }
    return {};
  };
}

test('an escalation with no resolver PAUSES the run, resumable from the paused role', async () => {
  const adapter = new MockRuntimeAdapter({ handler: escalateOnce('implementer') });
  const paused = await runRound(cfg('full'), { adapter });
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.pausedAt, 'implementer');
  assert.equal(paused.escalation?.question, 'A or B?');

  // Operator resolves; resume continues from the Implementer and returns the COMPLETE
  // run record — including the Architect phase that finished before the pause.
  const resumed = await resumeRound(paused, { answer: 'A' }, { adapter });
  assert.equal(resumed.status, 'COMPLETE');
  assert.deepEqual(roleOrder(resumed), ['architect', 'implementer', 'reviewer', 'memorial']);
});

test('an inline onEscalate resolver resolves and completes in one pass', async () => {
  const adapter = new MockRuntimeAdapter({ handler: escalateOnce('implementer') });
  let asked = '';
  const r = await runRound(cfg('full'), {
    adapter,
    onEscalate: async (e) => { asked = e.question; return { answer: 'A' }; },
  });
  assert.equal(asked, 'A or B?');
  assert.equal(r.status, 'COMPLETE');
  assert.deepEqual(roleOrder(r), ['architect', 'implementer', 'reviewer', 'memorial']);
});

test('a failing discipline gate halts the run (BLOCKED) before forwarding', async () => {
  const r = await runRound(cfg('full'), {
    adapter: new MockRuntimeAdapter(),
    gates: (result) => ({ pass: result.role !== 'reviewer', findings: ['mock gate fail'] }),
  });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'reviewer');
  assert.deepEqual(roleOrder(r), ['architect', 'implementer', 'reviewer']);
});

test('measurement record carries per-role usage and the no-bare-total CAVEAT', async () => {
  const r = await runRound(cfg('audit'), { adapter: new MockRuntimeAdapter() });
  const impl = r.phases.find((p) => p.role === 'implementer')!;
  assert.deepEqual(Object.keys(impl.usage).sort(), ['cache_creation', 'cache_read', 'input', 'output']);
  assert.match(r.CAVEAT, /No bare total cost/);
  assert.equal((r as Record<string, unknown>).cost, undefined); // never a bare total
});
