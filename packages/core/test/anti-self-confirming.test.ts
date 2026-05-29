import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAntiSelfConfirming } from '../src/index.ts';
import type { Mutation, MutationRunner } from '../src/index.ts';

const mutations: Mutation[] = [
  { id: 'm1', description: 'negate the §11.3 pre-release-lower comparison' },
  { id: 'm2', description: 'make core compare lexical instead of numeric' },
];

test('all mutations killed (tests fail on each) => pass', () => {
  const run: MutationRunner = () => ({ testsPass: false }); // tests failed => mutation killed
  const r = checkAntiSelfConfirming(mutations, run);
  assert.equal(r.pass, true);
  assert.equal(r.findings.length, 0);
});

test('a surviving mutation (tests still pass) => CRITICAL self-confirming finding', () => {
  const run: MutationRunner = (m) => ({ testsPass: m.id === 'm2' }); // m2 survives
  const r = checkAntiSelfConfirming(mutations, run);
  assert.equal(r.pass, false);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'CRITICAL');
  assert.equal(r.findings[0].location, 'm2');
  assert.match(r.findings[0].message, /self-confirming/);
});

test('no mutations => vacuous (NIT advisory), still passes', () => {
  const r = checkAntiSelfConfirming([], () => ({ testsPass: false }));
  assert.equal(r.pass, true);
  assert.equal(r.findings[0].severity, 'NIT');
});
