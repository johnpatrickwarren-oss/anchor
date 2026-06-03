import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatures, planStages, renderStages } from '../src/project/index.ts';

// ── parseFeatures ──
test('parseFeatures reads id, scope, and optional deps; ignores prose and dedups', () => {
  const text = [
    'Here is the plan for the project:',
    'ANCHOR-FEATURE [auth]: user signup + login',
    'ANCHOR-FEATURE [api] deps=[auth]: REST endpoints behind auth',
    'ANCHOR-FEATURE [ui] deps=[auth, api]: the web client',
    'ANCHOR-FEATURE [auth]: a duplicate that must be ignored',
    'That concludes the plan.',
  ].join('\n');
  const f = parseFeatures(text);
  assert.equal(f.length, 3);
  assert.deepEqual(f[0], { id: 'auth', directive: 'user signup + login', dependsOn: [] });
  assert.deepEqual(f[1], { id: 'api', directive: 'REST endpoints behind auth', dependsOn: ['auth'] });
  assert.deepEqual(f[2].dependsOn, ['auth', 'api']);
});

test('parseFeatures tolerates whitespace, case, and empty deps brackets; no lines → []', () => {
  assert.deepEqual(parseFeatures('no markers here'), []);
  const f = parseFeatures('anchor-feature  [ x ]  deps=[ ] :  do x  ');
  assert.deepEqual(f, [{ id: 'x', directive: 'do x', dependsOn: [] }]);
});

test('parseFeatures survives list markers models add (bullets, numbers, quotes)', () => {
  const text = [
    '- ANCHOR-FEATURE [a]: bullet dash',
    '* ANCHOR-FEATURE [b]: bullet star',
    '1. ANCHOR-FEATURE [c] deps=[a]: numbered dot',
    '2) ANCHOR-FEATURE [d]: numbered paren',
    '> ANCHOR-FEATURE [e]: blockquote',
    'the ANCHOR-FEATURE marker in prose must NOT match',
  ].join('\n');
  assert.deepEqual(parseFeatures(text).map((f) => f.id), ['a', 'b', 'c', 'd', 'e']);
});

// ── planStages: topological staging ──
test('planStages groups independent features together and sequences dependents', () => {
  const features = parseFeatures([
    'ANCHOR-FEATURE [auth]: a',
    'ANCHOR-FEATURE [logging]: b',          // independent of auth → same first stage
    'ANCHOR-FEATURE [api] deps=[auth]: c',
    'ANCHOR-FEATURE [ui] deps=[api, logging]: d',
  ].join('\n'));
  const stages = planStages(features);
  assert.deepEqual(stages.map((s) => s.map((f) => f.id)), [
    ['auth', 'logging'], // stage 1 — both have no deps, run concurrently
    ['api'],             // stage 2 — needs auth
    ['ui'],              // stage 3 — needs api + logging
  ]);
});

test('planStages: a fully independent set is one parallel stage', () => {
  const features = parseFeatures(['ANCHOR-FEATURE [a]: x', 'ANCHOR-FEATURE [b]: y', 'ANCHOR-FEATURE [c]: z'].join('\n'));
  const stages = planStages(features);
  assert.equal(stages.length, 1);
  assert.deepEqual(stages[0].map((f) => f.id), ['a', 'b', 'c']);
});

test('planStages keeps input order stable within a stage (replay-deterministic)', () => {
  const features = parseFeatures(['ANCHOR-FEATURE [z]: 1', 'ANCHOR-FEATURE [a]: 2', 'ANCHOR-FEATURE [m]: 3'].join('\n'));
  assert.deepEqual(planStages(features)[0].map((f) => f.id), ['z', 'a', 'm']);
});

// ── planStages: failure modes (loud, not silent) ──
test('planStages throws on an unknown dependency reference, naming the edge', () => {
  const features = parseFeatures(['ANCHOR-FEATURE [a] deps=[ghost]: x'].join('\n'));
  assert.throws(() => planStages(features), /depends on unknown feature "ghost"/);
});

test('planStages throws on a self-dependency', () => {
  const features = [{ id: 'a', directive: 'x', dependsOn: ['a'] }];
  assert.throws(() => planStages(features), /depends on itself/);
});

test('planStages throws on a dependency cycle, listing the members', () => {
  const features = [
    { id: 'a', directive: 'x', dependsOn: ['b'] },
    { id: 'b', directive: 'y', dependsOn: ['a'] },
  ];
  assert.throws(() => planStages(features), /cycle among: a, b/);
});

test('planStages throws on duplicate ids passed directly', () => {
  const features = [
    { id: 'a', directive: 'x', dependsOn: [] },
    { id: 'a', directive: 'y', dependsOn: [] },
  ];
  assert.throws(() => planStages(features), /duplicate feature id/);
});

// ── renderStages ──
test('renderStages shows stage numbers, parallel count, and ordering hints', () => {
  const features = parseFeatures(['ANCHOR-FEATURE [a]: x', 'ANCHOR-FEATURE [b]: y', 'ANCHOR-FEATURE [c] deps=[a, b]: z'].join('\n'));
  const out = renderStages(planStages(features));
  assert.match(out, /stage 1 — 2 in parallel/);
  assert.match(out, /stage 2:/);
  assert.match(out, /c \(after a, b\): z/);
  assert.equal(renderStages([]), '(no features)');
});
