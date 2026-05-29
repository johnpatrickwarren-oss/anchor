import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkGrillingEmitted, checkAntiScope, checkAntiScopeViolation,
  grillingGate, antiScopeGate, runRound, MockRuntimeAdapter,
  MemorialStore, MemoryPersistence, seedBuiltinDisciplines,
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
test('gates read config.specPath (canonical) — not just the role artifacts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-specpath-'));
  const specPath = join(dir, 'Q-R01-SPEC.md');
  writeFileSync(specPath, '# Spec\nBody with no self-review buckets and no excluded-items list.\n'); // omits grilling
  const r = await runRound(
    { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29', specPath },
    { adapter: new MockRuntimeAdapter(), gates: grillingGate(undefined, true) }, // reads config.specPath
  );
  assert.equal(r.status, 'BLOCKED'); // canonical spec has no grilling -> blocking gate halts
  assert.equal(r.pausedAt, 'architect');
});

test('a memorial-aware gate accrues V/C against its discipline (closing the loop)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anchor-accrual-'));
  const store = new MemorialStore(new MemoryPersistence());
  seedBuiltinDisciplines(store);
  const run = (specBody: string) => runRound(
    { roundId: 'R01', tier: 'full', task: 'demo', runDate: '2026-05-29', specPath: writeSpec(dir, specBody) },
    { adapter: new MockRuntimeAdapter(), gates: grillingGate(undefined, false, { sink: store, memorialId: 'pre-emit-grilling' }) },
  );
  await run('# Spec\nno self-review buckets here'); // missing grilling -> violation
  await run('## Pre-emit grilling\nCRITICAL: 0\nLIKELY-SURFACES: 0\nPRE-EMPTABLE: 0'); // has grilling -> confirmation
  const e = store.list().find((x) => x.id === 'pre-emit-grilling')!;
  assert.equal(e.vCount, 1);
  assert.equal(e.cCount, 1);
});

function writeSpec(dir: string, body: string): string {
  const p = join(dir, `Q-${Math.abs(hash(body))}-SPEC.md`);
  writeFileSync(p, body);
  return p;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

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
