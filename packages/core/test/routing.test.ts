import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTier, routeRound, runRoundFromDirective, selectImplementerClass, selectMemorialClass, selectReviewerClass, MockRuntimeAdapter,
} from '../src/index.ts';

test('classifyTier — priority-ordered heuristic (first match wins)', () => {
  assert.equal(classifyTier('Coordinator wave plan for wave 3').tier, 'coordinator-only');
  assert.equal(classifyTier('Modify engine/detectors/fcp.ts').tier, 'full');
  assert.equal(classifyTier('STATUS: ESCALATE — operator decision').tier, 'full');
  assert.equal(classifyTier('A2 (new architectural pattern): switch middleware').tier, 'full');
  assert.equal(classifyTier('Mechanical rename + documentation-only touch-up').tier, 'implementer-only');
  assert.equal(classifyTier('methodology REINFORCEMENT consolidation').tier, 'audit');
  assert.equal(classifyTier('Add a sortable column to the users table').tier, 'full'); // default escape hatch
});

test('coordinator/full markers beat lower rules (order matters)', () => {
  // contains both a mechanical word and an engine path -> full wins (rule 2 before rule 3)
  assert.equal(classifyTier('mechanical cleanup in engine/util.ts').tier, 'full');
});

test('selectImplementerClass — engine->reasoning, mechanical(implementer-only)->cheap, else balanced', () => {
  assert.equal(selectImplementerClass('touches engine/x.ts', 'full'), 'reasoning');
  assert.equal(selectImplementerClass('mechanical rename', 'implementer-only'), 'cheap');
  assert.equal(selectImplementerClass('mechanical rename', 'full'), 'balanced'); // mechanical only downgrades on implementer-only
  assert.equal(selectImplementerClass('add a feature', 'audit'), 'balanced');
});

test('selectMemorialClass — full+marker->balanced, else cheap', () => {
  assert.equal(selectMemorialClass('cross-project promotion of rule', 'full'), 'balanced');
  assert.equal(selectMemorialClass('routine round', 'full'), 'cheap');
  assert.equal(selectMemorialClass('cross-project promotion', 'audit'), 'cheap'); // markers only checked on full
});

test('selectReviewerClass — cost-aware: load-bearing->reasoning, mechanical/trivial->balanced, default opus', () => {
  assert.equal(selectReviewerClass('touches engine/x.ts', 'full'), 'reasoning');                 // load-bearing
  assert.equal(selectReviewerClass('architectural-decision: new pattern', 'full'), 'reasoning');
  assert.equal(selectReviewerClass('mechanical rename', 'implementer-only'), 'balanced');         // trivial tier
  assert.equal(selectReviewerClass('documentation-only touch-up', 'audit'), 'balanced');          // mechanical kw
  assert.equal(selectReviewerClass('add a feature', 'full'), 'reasoning');                        // default opus (substantive)
  assert.equal(selectReviewerClass('add a feature', 'audit'), 'reasoning');
});

test('routeRound routes the reviewer model by change-risk', () => {
  assert.equal(routeRound('Add a sortable column to the users table').modelOverrides.reviewer, 'claude-opus-4-8'); // substantive -> opus
  assert.equal(routeRound('documentation-only touch-up', { tierOverride: 'audit' }).modelOverrides.reviewer, 'claude-sonnet-4-6'); // mechanical -> sonnet
});

test('routeRound resolves classes to concrete model ids; tierOverride wins', () => {
  const r = routeRound('Modify engine/detectors/fcp.ts — architectural-decision');
  assert.equal(r.tier, 'full');
  assert.equal(r.modelOverrides.implementer, 'claude-opus-4-8'); // reasoning class

  const pinned = routeRound('Modify engine/x.ts', { tierOverride: 'audit' });
  assert.equal(pinned.tier, 'audit');
});

test('runRoundFromDirective self-routes tier and per-role model', async () => {
  let implModel = '';
  const adapter = new MockRuntimeAdapter({ handler: (spec) => { if (spec.role === 'implementer') implModel = spec.model; return {}; } });
  const r = await runRoundFromDirective(
    'Modify the e-process detector in engine/detectors/fcp.ts (architectural-decision).',
    { adapter },
    { roundId: 'R20', runDate: '2026-05-29' },
  );
  assert.equal(r.tier, 'full'); // classified from 'engine/' + architectural-decision
  assert.deepEqual(r.phases.map((p) => p.role), ['architect', 'implementer', 'reviewer', 'memorial']);
  assert.equal(implModel, 'claude-opus-4-8'); // implementer upgraded to reasoning for engine work
});
