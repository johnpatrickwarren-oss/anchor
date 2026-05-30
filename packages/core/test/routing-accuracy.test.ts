// Layer-1 routing-accuracy harness: measures how well the deterministic routing matches the
// minimum-sufficient gold in routing-corpus.ts. Cheap (pure functions, no live runs), runs in CI.
//
// The metric is NOT symmetric accuracy. Two error types with very different costs:
//   - UNDER-scaling (chose fewer roles / a cheaper model than gold) → quality risk. HARD-FAIL.
//   - OVER-scaling  (chose more than gold) → wasted cost. Reported, tolerated.
// So the harness hard-asserts ZERO under-scaling + an exact-match floor on the clear cases, and
// prints a confusion matrix + over-provisioning cost. `probe` cases are reported, not asserted
// (they are the Layer-2 oracle watch-list).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTier, selectRoleModelClasses } from '../src/index.ts';
import type { Tier, Role, ModelClass } from '../src/index.ts';
import { ROUTING_CORPUS } from './routing-corpus.ts';

// Scale rank for under/over-scaling (more roles = higher). coordinator-only is OFF this axis
// (a different kind of round) → rank null, exact-match only.
const TIER_RANK: Record<Tier, number | null> = {
  'implementer-only': 1, solo: 1, audit: 2, full: 3, 'coordinator-only': null,
};
// Measured $/feature from the live runs (implementer-only r8, audit r7, full r3/r4) — for the
// over-provisioning + safety-premium reports. Note how flat solo↔audit is once the reviewer is
// sonnet: dropping roles barely saves (work relocates to the implementer).
const TIER_COST: Record<Tier, number> = {
  'implementer-only': 0.65, solo: 0.65, audit: 0.70, full: 2.4, 'coordinator-only': 0.3,
};
const MODEL_RANK: Record<ModelClass, number> = { cheap: 1, balanced: 2, reasoning: 3 };

const isProbe = (c: { tags?: string[] }) => c.tags?.includes('probe');
const fmt = (n: number) => n.toFixed(2);

test('routing accuracy — tier: zero under-scaling; exact-match floor on clear cases', () => {
  const clear = ROUTING_CORPUS.filter((c) => !isProbe(c));
  const confusion: Record<string, Record<string, number>> = {};
  let exact = 0; const under: string[] = []; const over: string[] = [];
  let wasted = 0;

  for (const c of clear) {
    const pred = classifyTier(c.directive).tier;
    (confusion[c.goldTier] ??= {})[pred] = ((confusion[c.goldTier] ??= {})[pred] ?? 0) + 1;
    if (pred === c.goldTier) { exact++; continue; }
    const pr = TIER_RANK[pred], gr = TIER_RANK[c.goldTier];
    if (pr === null || gr === null) { over.push(`${c.id}: gold ${c.goldTier} → got ${pred} (off-axis)`); continue; }
    if (pr < gr) under.push(`${c.id}: gold ${c.goldTier} → got ${pred} (UNDER)`);
    else { over.push(`${c.id}: gold ${c.goldTier} → got ${pred} (over)`); wasted += TIER_COST[pred] - TIER_COST[c.goldTier]; }
  }

  // Report
  console.log('\n  tier confusion (gold → pred):');
  for (const g of Object.keys(confusion)) console.log(`    ${g.padEnd(17)} ${JSON.stringify(confusion[g])}`);
  console.log(`  exact-match: ${exact}/${clear.length} (${fmt(100 * exact / clear.length)}%)  | under: ${under.length}  over: ${over.length}  | wasted ~$${fmt(wasted)} over the corpus`);
  if (under.length) console.log('  UNDER-SCALES (dangerous):\n    ' + under.join('\n    '));
  if (over.length) console.log('  over-scales (safe/wasteful):\n    ' + over.join('\n    '));

  // Asserts: zero UNDER-scaling is the hard safety invariant (under-scaling ships bugs);
  // over-scaling is safe-but-wasteful so it's only reported; exact-match has a softer floor
  // (over-scales are acceptable, so the floor guards against drift, not perfection).
  assert.equal(under.length, 0, `tier under-scaling detected (quality risk):\n${under.join('\n')}`);
  assert.ok(exact / clear.length >= 0.85, `tier exact-match ${fmt(exact / clear.length)} below 0.85 floor`);
});

test('routing accuracy — model safety: high-stakes never downgraded; trivial never opus', () => {
  const violations: string[] = [];
  for (const c of ROUTING_CORPUS) {
    if (isProbe(c)) continue;
    const classes = selectRoleModelClasses(c.directive, classifyTier(c.directive).tier);
    const hs = c.tags?.includes('high-stakes');
    const trivial = c.goldTier === 'implementer-only';
    for (const [role, cls] of Object.entries(classes) as [Role, ModelClass][]) {
      // High-stakes: the judgment roles (reviewer/architect/implementer) must stay reasoning.
      if (hs && (role === 'reviewer' || role === 'architect' || role === 'implementer') && MODEL_RANK[cls] < MODEL_RANK.reasoning)
        violations.push(`${c.id}: high-stakes ${role} downgraded to ${cls}`);
      // Trivial: nothing should burn opus.
      if (trivial && cls === 'reasoning') violations.push(`${c.id}: trivial work routed ${role} to opus (waste)`);
    }
  }
  if (violations.length) console.log('  model-safety violations:\n    ' + violations.join('\n    '));
  assert.equal(violations.length, 0, `model routing safety violations:\n${violations.join('\n')}`);
});

test('routing accuracy — gold model classes (where specified) are not UNDER-provisioned', () => {
  // Where a case pins gold per-role classes, the heuristic must not route BELOW them (cheaper).
  // Over (pricier) is reported, not failed.
  const under: string[] = []; const over: string[] = [];
  for (const c of ROUTING_CORPUS) {
    if (isProbe(c) || !c.goldModels) continue;
    const classes = selectRoleModelClasses(c.directive, c.goldTier);
    for (const [role, goldCls] of Object.entries(c.goldModels) as [Role, ModelClass][]) {
      const got = classes[role];
      if (!got) continue; // role not run at this tier
      if (MODEL_RANK[got] < MODEL_RANK[goldCls]) under.push(`${c.id}.${role}: gold ${goldCls} → got ${got} (UNDER)`);
      else if (MODEL_RANK[got] > MODEL_RANK[goldCls]) over.push(`${c.id}.${role}: gold ${goldCls} → got ${got} (over)`);
    }
  }
  if (over.length) console.log('  model over-provision:\n    ' + over.join('\n    '));
  assert.equal(under.length, 0, `model under-provisioning vs gold:\n${under.join('\n')}`);
});

test('routing accuracy — policy vs oracle: the safety premium is small (Layer-2 grounded)', () => {
  // Where the live oracle is known, gold (policy) may over-scale it for review/learning. Report
  // the premium = cost(gold) - cost(oracle). The finding: it's tiny once the reviewer is sonnet,
  // so the policy's over-scale on additive work is justified (review + memorial for ~pennies).
  const grounded = ROUTING_CORPUS.filter((c) => c.oracleTier && c.oracleTier !== c.goldTier);
  let premium = 0; const lines: string[] = [];
  for (const c of grounded) {
    const p = TIER_COST[c.goldTier] - TIER_COST[c.oracleTier!];
    premium += p;
    lines.push(`    ${c.id}: policy ${c.goldTier} ($${TIER_COST[c.goldTier]}) over oracle ${c.oracleTier} ($${TIER_COST[c.oracleTier!]}) = +$${p.toFixed(2)}/feature`);
    // Sanity: the policy must never UNDER-scale the oracle (that would be a quality risk).
    assert.ok(TIER_COST[c.goldTier] >= TIER_COST[c.oracleTier!], `${c.id}: policy under the oracle`);
  }
  console.log(`\n  Layer-2 oracle-grounded cases: ${grounded.length}; mean safety premium $${grounded.length ? (premium / grounded.length).toFixed(2) : '0'}/feature`);
  for (const l of lines) console.log(l);
});

test('routing accuracy — probe watch-list (reported, not asserted; Layer-2 oracle resolves)', () => {
  const probes = ROUTING_CORPUS.filter(isProbe);
  const diverged = probes
    .map((c) => ({ c, pred: classifyTier(c.directive).tier }))
    .filter(({ c, pred }) => pred !== c.goldTier);
  console.log(`\n  probes: ${probes.length}, diverged from ideal: ${diverged.length}`);
  for (const { c, pred } of diverged) {
    const pr = TIER_RANK[pred], gr = TIER_RANK[c.goldTier];
    const dir = pr !== null && gr !== null ? (pr < gr ? 'UNDER (watch!)' : 'over') : 'off-axis';
    console.log(`    ${c.id}: ideal ${c.goldTier} → heuristic ${pred} [${dir}] — ${c.rationale}`);
  }
  assert.ok(true); // never fails; this is the Layer-2 candidate list
});
