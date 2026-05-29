import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentSdkAdapter, mapUsage, extractArtifacts, detectStatus, parseStatusContract, parseMemorialSignals, buildQueryOptions, isMaxTurns, isTransient,
} from '../src/index.ts';
import type { SdkMessage } from '../src/index.ts';

const noSleep = async () => {}; // inject so retry backoff doesn't add real delay in tests

// A RoleSpec-shaped object (types are erased at runtime; the engine passes this shape).
const spec = { role: 'implementer', model: 'claude-sonnet-4-6', contextRefs: ['coordination/specs/Q-R01-SPEC.md'], prompt: 'Implement X.', tools: ['Read', 'Write', 'Bash'] };

function fakeQuery(messages: SdkMessage[]) {
  return async function* () {
    for (const m of messages) yield m;
  }();
}

// A stream that yields some messages, then THROWS (mirrors SDK builds that throw on
// turn-budget exhaustion rather than yielding an error result).
function throwingQuery(messages: SdkMessage[], error: Error) {
  return async function* () {
    for (const m of messages) yield m;
    throw error;
  }();
}

test('spawnRole maps usage, artifacts, status, and cost from the SDK stream', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'src/compareSemver.mjs' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'test/compareSemver.test.mjs' } }, { type: 'text', text: 'Done. 7/7 tests pass.' }] } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.42, usage: { input_tokens: 5, output_tokens: 50, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } },
  ];
  const adapter = new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) });
  const r = await adapter.spawnRole(spec as never);

  assert.equal(r.role, 'implementer');
  assert.equal(r.status, 'READY');
  assert.deepEqual(r.artifacts, ['src/compareSemver.mjs', 'test/compareSemver.test.mjs']);
  assert.deepEqual(r.usage, { input: 5, cache_creation: 100, cache_read: 200, output: 50 });
  assert.equal((r.handoff as { cost_usd: number }).cost_usd, 0.42);
});

test('an ESCALATE in the final text surfaces a structured escalation', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ESCALATE: pre-release sort ASCII vs unicode — which?' }] } },
    { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 9 } },
  ];
  const r = await new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) }).spawnRole(spec as never);
  assert.equal(r.status, 'ESCALATE');
  assert.match(r.escalation!.question, /ASCII vs unicode/);
  assert.equal(r.escalation!.raisedBy, 'implementer');
});

test('a non-max-turns SDK error result maps to BLOCKED', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
    { type: 'result', subtype: 'error_during_execution', usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const r = await new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) }).spawnRole(spec as never);
  assert.equal(r.status, 'BLOCKED');
});

test('an error_max_turns result degrades to a resumable ESCALATE, preserving usage + artifacts', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'coverage.ts' } }, { type: 'text', text: 'partial' }] } },
    { type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.9, usage: { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 } },
  ];
  const r = await new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) }).spawnRole(spec as never);
  assert.equal(r.status, 'ESCALATE');
  assert.match(r.escalation!.question, /turn budget|maxTurns/i);
  assert.deepEqual(r.artifacts, ['coverage.ts']);          // partial work preserved
  assert.deepEqual(r.usage, { input: 3, cache_creation: 10, cache_read: 20, output: 7 }); // usage preserved
});

test('a THROWN max-turns error degrades to a resumable ESCALATE (does not crash the run)', async () => {
  const before: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'coverage.ts' } }] } },
  ];
  const q = () => throwingQuery(before, new Error('Reached maximum number of turns (25)'));
  const r = await new AgentSdkAdapter({ queryFn: q }).spawnRole(spec as never);
  assert.equal(r.status, 'ESCALATE');
  assert.equal(r.escalation!.raisedBy, 'implementer');
  assert.deepEqual(r.artifacts, ['coverage.ts']);          // files written before the throw survive
});

test('a transient error is retried then succeeds (no crash, READY)', async () => {
  let calls = 0;
  const okStream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x.ts' } }, { type: 'text', text: 'done' }] } },
    { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 2 } },
  ];
  // Throw a transient error on the first two attempts, succeed on the third.
  const q = () => (calls++ < 2 ? throwingQuery([], new Error('API Error: 529 Overloaded')) : fakeQuery(okStream));
  const r = await new AgentSdkAdapter({ queryFn: q, sleep: noSleep }).spawnRole(spec as never);
  assert.equal(r.status, 'READY');
  assert.deepEqual(r.artifacts, ['x.ts']);
  assert.equal(calls, 3); // 2 transient throws + 1 success
});

test('a transient error that never clears degrades to a resumable ESCALATE (bounded retries, no crash)', async () => {
  let calls = 0;
  const q = () => { calls++; return throwingQuery([], new Error('socket connection closed unexpectedly')); };
  const r = await new AgentSdkAdapter({ queryFn: q, sleep: noSleep, maxRetries: 2 }).spawnRole(spec as never);
  assert.equal(r.status, 'ESCALATE');
  assert.match(r.escalation!.question, /socket connection closed/i);
  assert.equal(calls, 3); // initial + 2 retries, then give up gracefully
});

test('a genuine (non-transient) error degrades to ESCALATE without retrying (preserve-on-error)', async () => {
  let calls = 0;
  const before: SdkMessage[] = [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'partial.ts' } }] } }];
  const q = () => { calls++; return throwingQuery(before, new Error('Invalid API key — please run /login')); };
  const r = await new AgentSdkAdapter({ queryFn: q, sleep: noSleep }).spawnRole(spec as never);
  assert.equal(r.status, 'ESCALATE');           // never crashes
  assert.match(r.escalation!.question, /Invalid API key/);
  assert.deepEqual(r.artifacts, ['partial.ts']); // partial work preserved
  assert.equal(calls, 1);                        // non-transient → no retry
});

test('isTransient flags retryable server/network errors, not terminal ones', () => {
  assert.equal(isTransient(new Error('API Error: 529 Overloaded')), true);
  assert.equal(isTransient(new Error('socket connection closed unexpectedly')), true);
  assert.equal(isTransient(new Error('read ECONNRESET')), true);
  assert.equal(isTransient(new Error('429 Too Many Requests')), true);
  assert.equal(isTransient(new Error('Invalid API key')), false);
  assert.equal(isTransient(new Error('Reached maximum number of turns (25)')), false);
  assert.equal(isTransient(undefined), false);
});

test('parseMemorialSignals reads CONFIRM/VIOLATE id lists; tolerant of brackets, spacing, absence', () => {
  const text = [
    'Review complete. CRITICAL: none.',
    'ANCHOR-STATUS: READY',
    'ANCHOR-MEMORIAL-CONFIRM: additive-replay-clean, [no-self-confirming-demo]',
    'ANCHOR-MEMORIAL-VIOLATE: determinism-no-rng',
  ].join('\n');
  assert.deepEqual(parseMemorialSignals(text), {
    confirm: ['additive-replay-clean', 'no-self-confirming-demo'], // `[id]` brackets stripped
    violate: ['determinism-no-rng'],
  });
  // No memorial lines → empty arrays (not undefined), so the engine path is a clean no-op.
  assert.deepEqual(parseMemorialSignals('ANCHOR-STATUS: READY'), { confirm: [], violate: [] });
});

test('spawnRole surfaces memorialSignals parsed from the role output', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ANCHOR-STATUS: READY\nANCHOR-MEMORIAL-CONFIRM: additive-replay-clean\nANCHOR-MEMORIAL-VIOLATE: no-rng' }] } },
    { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 2 } },
  ];
  const r = await new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) }).spawnRole({ ...spec, role: 'reviewer' } as never);
  assert.deepEqual(r.memorialSignals, { confirm: ['additive-replay-clean'], violate: ['no-rng'] });
});

test('isMaxTurns recognizes the result subtype and thrown messages, not unrelated errors', () => {
  assert.equal(isMaxTurns({ type: 'result', subtype: 'error_max_turns' } as never, undefined), true);
  assert.equal(isMaxTurns(undefined, new Error('Reached maximum number of turns (25)')), true);
  assert.equal(isMaxTurns(undefined, new Error('max-turns exceeded')), true);
  assert.equal(isMaxTurns(undefined, new Error('network timeout')), false);
  assert.equal(isMaxTurns({ type: 'result', subtype: 'success' } as never, undefined), false);
});

test('mapUsage handles missing fields (all zero)', () => {
  assert.deepEqual(mapUsage(undefined), { input: 0, cache_creation: 0, cache_read: 0, output: 0 });
  assert.deepEqual(mapUsage({ output_tokens: 7 }), { input: 0, cache_creation: 0, cache_read: 0, output: 7 });
});

test('extractArtifacts collects write/edit tool paths, deduped; ignores read tools', () => {
  const msgs: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'b.ts' } }, { type: 'tool_use', name: 'Edit', input: { file_path: 'b.ts' } }] } },
  ];
  assert.deepEqual(extractArtifacts(msgs), ['b.ts']);
});

test('detectStatus reads Anchor NEXT-ROLE signals (line-leading markers)', () => {
  assert.equal(detectStatus('all good', 'reviewer').status, 'READY');
  assert.equal(detectStatus('HALT — spec contradicts reality', 'implementer').status, 'BLOCKED');
  assert.equal(detectStatus('summary line\nSTATUS: BLOCKED\nreason', 'implementer').status, 'BLOCKED');
  assert.equal(detectStatus('ESCALATE: A or B?', 'architect').status, 'ESCALATE');
});

test('detectStatus does NOT false-positive on prose mentions of halt words (live-run regression)', () => {
  // A successful Implementer that merely *mentions* the keywords must stay READY.
  assert.equal(detectStatus('Done. No HALT or DIAGNOSTIC was needed — the spec was clear.', 'implementer').status, 'READY');
  assert.equal(detectStatus('Implemented isEven; 2/2 tests pass. Nothing blocked.', 'implementer').status, 'READY');
});

test('parseStatusContract reads the explicit ANCHOR-STATUS sentinel (READY/ESCALATE/BLOCKED)', () => {
  assert.equal(parseStatusContract('work…\nANCHOR-STATUS: READY', 'implementer').status, 'READY');
  assert.equal(parseStatusContract('…\nANCHOR-STATUS: BLOCKED', 'implementer').status, 'BLOCKED');
  const e = parseStatusContract('…\nANCHOR-STATUS: ESCALATE\nANCHOR-ESCALATE: A or B?', 'architect');
  assert.equal(e.status, 'ESCALATE');
  assert.match(e.escalation!.question, /A or B\?/);
});

test('the explicit sentinel OVERRIDES a heuristic false-positive', () => {
  // "HALT:" at line start would trip the heuristic, but the sentinel is authoritative.
  assert.equal(parseStatusContract('HALT: (not really)\nANCHOR-STATUS: READY', 'implementer').status, 'READY');
});

test('parseStatusContract falls back to the heuristic when no sentinel is present', () => {
  assert.equal(parseStatusContract('summary\nSTATUS: BLOCKED', 'implementer').status, 'BLOCKED');
  assert.equal(parseStatusContract('all good', 'reviewer').status, 'READY');
});

test('buildQueryOptions maps model, defaults permissionMode to acceptEdits, sets a role system prompt', () => {
  const o = buildQueryOptions(spec as never, {});
  assert.equal(o.model, 'claude-sonnet-4-6');
  assert.equal(o.permissionMode, 'acceptEdits');
  assert.deepEqual(o.allowedTools, ['Read', 'Write', 'Bash']);
  assert.match(o.systemPrompt!, /IMPLEMENTER/);
});
