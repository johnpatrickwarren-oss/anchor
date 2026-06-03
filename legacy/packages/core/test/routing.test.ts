import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTier, routeRound, runRoundFromDirective, selectImplementerClass, selectMemorialClass, selectReviewerClass, selectArchitectClass, MockRuntimeAdapter,
} from '../src/index.ts';

test('classifyTier — priority-ordered heuristic (first match wins)', () => {
  assert.equal(classifyTier('Coordinator wave plan for wave 3').tier, 'coordinator-only');
  assert.equal(classifyTier('Modify engine/detectors/fcp.ts').tier, 'full');
  assert.equal(classifyTier('STATUS: ESCALATE — operator decision').tier, 'full');
  assert.equal(classifyTier('A2 (new architectural pattern): switch middleware').tier, 'full');
  assert.equal(classifyTier('Mechanical rename + documentation-only touch-up').tier, 'implementer-only');
  assert.equal(classifyTier('methodology REINFORCEMENT consolidation').tier, 'audit');
});

test('classifyTier — un-marked tasks default LEAN (audit), not full; risk escalates to full', () => {
  // The inverted default: no marker → the gate-backstopped verified loop (audit), NOT full.
  assert.equal(classifyTier('Add a sortable column to the users table').tier, 'audit');
  assert.equal(classifyTier('add merge').tier, 'audit');                          // terse/ambiguous → lean, not full
  assert.equal(classifyTier('Change the merge tiebreak in merge.ts').tier, 'audit'); // contained edit → audit
  // …but a genuine risk domain escalates to full even with no methodology marker:
  assert.equal(classifyTier('Refactor the auth flow to support SSO').tier, 'full');   // auth risk domain
  assert.equal(classifyTier('Add an endpoint that changes the request schema').tier, 'full'); // schema risk
  assert.equal(classifyTier('Add a caching layer to the API client').tier, 'full');   // cross-cutting over existing code
});

test('classifyTier — self-contained additive work scales DOWN to audit (no separate architect)', () => {
  assert.equal(classifyTier('new module merge.ts; additive, no score.ts change').tier, 'audit');
  assert.equal(classifyTier('pure + deterministic; additive helper').tier, 'audit');
  assert.equal(classifyTier('read-only summary over existing ranked output').tier, 'audit');
  // but the high-stakes guard wins: additive wording does NOT downgrade engine/architectural work
  assert.equal(classifyTier('additive change to engine/score.ts').tier, 'full');
  assert.equal(classifyTier('additive, but architectural-decision required').tier, 'full');
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
  assert.equal(selectReviewerClass('add a feature', 'full'), 'reasoning');                        // full + substantive -> opus
  assert.equal(selectReviewerClass('add a feature', 'audit'), 'balanced');                        // audit (scaled-down + gate-backstopped) -> sonnet
  assert.equal(selectReviewerClass('architectural-decision', 'audit'), 'reasoning');              // but high-stakes still wins -> opus
});

test('routeRound routes the reviewer model by change-risk', () => {
  assert.equal(routeRound('Modify engine/detectors/fcp.ts — architectural-decision').modelOverrides.reviewer, 'claude-opus-4-8'); // high-stakes -> opus
  assert.equal(routeRound('documentation-only touch-up', { tierOverride: 'audit' }).modelOverrides.reviewer, 'claude-sonnet-4-6'); // mechanical -> sonnet
});

test('selectArchitectClass — load-bearing->reasoning, mechanical->cheap, routine->balanced', () => {
  assert.equal(selectArchitectClass('Modify engine/detectors/fcp.ts', 'full'), 'reasoning');
  assert.equal(selectArchitectClass('A2 (new architectural pattern): switch middleware', 'full'), 'reasoning');
  assert.equal(selectArchitectClass('fix a typo in the README (doc-only)', 'full'), 'cheap'); // mechanical -> faster
  assert.equal(selectArchitectClass('Add a sortable column to the users table', 'full'), 'balanced'); // routine
});

test('routeRound routes the architect model by change-risk (full tier only)', () => {
  assert.equal(routeRound('Modify engine/detectors/fcp.ts — architectural-decision').modelOverrides.architect, 'claude-opus-4-8'); // load-bearing
  assert.equal(routeRound('Add a caching layer to the API client').modelOverrides.architect, 'claude-sonnet-4-6'); // full (broad brownfield) but not opus-class -> sonnet architect
  assert.equal(routeRound('add a feature', { tierOverride: 'audit' }).modelOverrides.architect, undefined); // no architect off full tier
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
  // High-risk (engine/ + architectural-decision) → adaptive structure adds a 2nd reviewer pass.
  assert.deepEqual(r.phases.map((p) => p.role), ['architect', 'implementer', 'reviewer', 'reviewer', 'memorial']);
  assert.equal(implModel, 'claude-opus-4-8'); // implementer upgraded to reasoning for engine work
});
