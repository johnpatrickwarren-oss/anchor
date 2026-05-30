import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkModelDrift, ROUTING_PROVENANCE, routeRound, runRoundFromDirective, MockRuntimeAdapter } from '../src/index.ts';

test('checkModelDrift: the grounded set alone is not drifted', () => {
  const r = checkModelDrift(ROUTING_PROVENANCE.models);
  assert.equal(r.drifted, false);
  assert.deepEqual(r.newModels, []);
  assert.equal(r.groundedDate, ROUTING_PROVENANCE.groundedDate);
});

test('checkModelDrift: an ungrounded model id → drifted + lists exactly the new ones', () => {
  const r = checkModelDrift([...ROUTING_PROVENANCE.models, 'claude-opus-5-0']);
  assert.equal(r.drifted, true);
  assert.deepEqual(r.newModels, ['claude-opus-5-0']);
});

test('safe routing: over-provisions — full tier + reasoning (opus) for every role', () => {
  const normal = routeRound('new module merge.ts; additive, pure + deterministic');
  assert.equal(normal.tier, 'audit'); // would scale down normally
  const safe = routeRound('new module merge.ts; additive, pure + deterministic', { safe: true });
  assert.equal(safe.tier, 'full'); // fail-safe forces the max role set
  for (const m of Object.values(safe.modelOverrides)) assert.equal(m, 'claude-opus-4-8');
});

test('safe routing: an operator tier pin still wins, but models are still upgraded', () => {
  const r = routeRound('add a feature', { safe: true, tierOverride: 'audit' });
  assert.equal(r.tier, 'audit');
  for (const m of Object.values(r.modelOverrides)) assert.equal(m, 'claude-opus-4-8');
});

test('runRoundFromDirective: meta.safe over-provisions end to end', async () => {
  const r = await runRoundFromDirective(
    'new module merge.ts; additive',
    { adapter: new MockRuntimeAdapter() },
    { roundId: 'R1', runDate: '2026-05-30', safe: true },
  );
  assert.equal(r.tier, 'full'); // ungrounded-model fail-safe ran the full cycle
});
