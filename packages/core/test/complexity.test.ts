import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessTask, hasRiskDomain } from '../src/index.ts';

test('hasRiskDomain flags security / money / data-loss / schema / concurrency work', () => {
  for (const d of [
    'add auth to the API', 'reset a user password', 'issue an oauth token', 'wire up SSO',
    'add a payment webhook', 'run a DB migration', 'change the orders schema',
    'fix a race condition in the queue', 'delete old records', 'patch an XSS vulnerability',
  ]) assert.equal(hasRiskDomain(d), true, `should be risk: ${d}`);

  for (const d of ['add a slugify helper', 'format the CLI output', 'parse a CSV string', 'add merge']) {
    assert.equal(hasRiskDomain(d), false, `should NOT be risk: ${d}`);
  }
});

test('assessTask defaults LEAN (audit); escalates to full only on risk or broad-brownfield', () => {
  // lean default — ambiguous / greenfield / contained → the verified loop, not full
  assert.equal(assessTask('add merge').tier, 'audit');
  assert.equal(assessTask('build a slugify function with tests').tier, 'audit');
  assert.equal(assessTask('change the tiebreak in merge.ts').tier, 'audit'); // brownfield but contained

  // full — a risk domain (auth/schema/…) regardless of how small it looks
  assert.equal(assessTask('refactor the auth flow for SSO').tier, 'full');
  assert.equal(assessTask('a migration that alters the orders schema').tier, 'full');

  // full — broad change to existing code (brownfield + cross-cutting)
  assert.equal(assessTask('add a caching layer across the existing services').tier, 'full');
});

test('assessTask.high drives the adaptive 2nd reviewer only for genuine high-risk', () => {
  assert.equal(assessTask('refactor the auth flow').high, true);   // risk domain
  assert.equal(assessTask('add merge').high, false);               // lean default
  assert.equal(assessTask('change the tiebreak in merge.ts').high, false); // contained brownfield
  assert.deepEqual(assessTask('add merge').signals, ['lean-default']);
});
