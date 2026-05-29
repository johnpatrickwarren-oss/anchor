import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGrillingEmitted, checkAntiScope, checkAntiScopeViolation,
  grillingGate, antiScopeGate, runRound, MockRuntimeAdapter,
} from '../src/index.ts';
import type { RoundConfig, RoleResult, RoleSpec } from '../src/index.ts';

const cfg: RoundConfig = { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29' };

// ── checkGrillingEmitted ──
test('grilling: three buckets present -> pass; heading present -> pass; neither -> CRITICAL', () => {
  assert.equal(checkGrillingEmitted('… CRITICAL: 1 … LIKELY-SURFACES: 2 … PRE-EMPTABLE: 0 …').pass, true);
  assert.equal(checkGrillingEmitted('## Pre-emit grilling pass\n(none)').pass, true);
  const bad = checkGrillingEmitted('a spec with no self-review at all');
  assert.equal(bad.pass, false);
  assert.equal(bad.findings[0].severity, 'CRITICAL');
});

// ── checkAntiScope ──
test('anti-scope: section present -> pass; absent -> CRITICAL', () => {
  assert.equal(checkAntiScope('## Anti-scope\n- NO ranges.').pass, true);
  assert.equal(checkAntiScope('a spec with no out-of-scope list').pass, false);
});

// ── checkAntiScopeViolation ──
test('anti-scope violation: written file matching a pattern -> CRITICAL; glob supported', () => {
  assert.equal(checkAntiScopeViolation(['vendor/'], ['src/a.ts']).pass, true);
  const v = checkAntiScopeViolation(['vendor/*'], ['vendor/anchor/x.md']);
  assert.equal(v.pass, false);
  assert.equal(v.findings[0].location, 'vendor/anchor/x.md');
});

// ── engine wiring: a missing grilling section blocks the run at the Architect ──
test('grillingGate halts the run when the spec carries no grilling pass', async () => {
  const r = await runRound(cfg, {
    adapter: new MockRuntimeAdapter(),
    gates: grillingGate(() => 'a spec without any grilling'),
  });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'architect');
});

test('grillingGate passes when the spec carries a grilling pass', async () => {
  const r = await runRound(cfg, {
    adapter: new MockRuntimeAdapter(),
    gates: grillingGate(() => '## Pre-emit grilling\nCRITICAL: 0\nLIKELY-SURFACES: 1\nPRE-EMPTABLE: 0'),
  });
  assert.equal(r.status, 'COMPLETE');
});

test('advisory gate (blocking=false) surfaces warnings WITHOUT halting', async () => {
  const r = await runRound(cfg, {
    adapter: new MockRuntimeAdapter(),
    gates: grillingGate(() => 'a spec without any grilling', false),
  });
  assert.equal(r.status, 'COMPLETE');
  assert.ok(r.warnings.some((w) => /grilling/i.test(w)), 'advisory grilling finding should surface as a warning');
});

test('antiScopeGate halts when the spec has no anti-scope section', async () => {
  const r = await runRound(cfg, {
    adapter: new MockRuntimeAdapter(),
    gates: antiScopeGate({ specTextFor: () => 'a spec with no out-of-scope list' }),
  });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.pausedAt, 'architect');
});

// ── prompt wiring (layer 2): the default role prompts now instruct the disciplines ──
test('default role prompts instruct grilling + anti-scope (architect) and anti-self-confirming (implementer/reviewer)', async () => {
  const prompts: Record<string, string> = {};
  const adapter = new MockRuntimeAdapter({ handler: (spec: RoleSpec) => { prompts[spec.role] = spec.prompt; return {}; } });
  await runRound(cfg, { adapter });
  assert.match(prompts.architect, /Anti-scope/i);
  assert.match(prompts.architect, /grilling/i);
  assert.match(prompts.architect, /Existing architectural surface/i);
  assert.match(prompts.implementer, /self-confirming/i);
  assert.match(prompts.reviewer, /anti-self-confirming/i);
});
