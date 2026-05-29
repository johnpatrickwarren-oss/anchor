import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentSdkAdapter, mapUsage, extractArtifacts, detectStatus, buildQueryOptions,
} from '../src/index.ts';
import type { SdkMessage } from '../src/index.ts';

// A RoleSpec-shaped object (types are erased at runtime; the engine passes this shape).
const spec = { role: 'implementer', model: 'claude-sonnet-4-6', contextRefs: ['coordination/specs/Q-R01-SPEC.md'], prompt: 'Implement X.', tools: ['Read', 'Write', 'Bash'] };

function fakeQuery(messages: SdkMessage[]) {
  return async function* () {
    for (const m of messages) yield m;
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

test('an SDK error result maps to BLOCKED', async () => {
  const stream: SdkMessage[] = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
    { type: 'result', subtype: 'error_max_turns', usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const r = await new AgentSdkAdapter({ queryFn: () => fakeQuery(stream) }).spawnRole(spec as never);
  assert.equal(r.status, 'BLOCKED');
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

test('detectStatus reads Anchor NEXT-ROLE signals', () => {
  assert.equal(detectStatus('all good', 'reviewer').status, 'READY');
  assert.equal(detectStatus('HALT — spec contradicts reality', 'implementer').status, 'BLOCKED');
  assert.equal(detectStatus('ESCALATE: A or B?', 'architect').status, 'ESCALATE');
});

test('buildQueryOptions maps model, defaults permissionMode to acceptEdits, sets a role system prompt', () => {
  const o = buildQueryOptions(spec as never, {});
  assert.equal(o.model, 'claude-sonnet-4-6');
  assert.equal(o.permissionMode, 'acceptEdits');
  assert.deepEqual(o.allowedTools, ['Read', 'Write', 'Bash']);
  assert.match(o.systemPrompt!, /IMPLEMENTER/);
});
