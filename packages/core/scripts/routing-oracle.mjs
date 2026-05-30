#!/usr/bin/env node
// Layer-2 routing ORACLE (stub). The deterministic Layer-1 harness (test/routing-accuracy.test.ts)
// scores classifyTier against HAND/gold labels — cheap, but the labels are judgment. This script
// GROUNDS those labels empirically: for each directive it runs the round at every candidate tier
// (and, optionally, per-role model ablations), scores each run by the REAL outcome, and derives
// the oracle = the cheapest config that still produces COMPLETE + green + correct. The classifier
// is "accurate" to the degree it matches that oracle (and never picks below it).
//
// This is the systematized version of the manual r5→r6→r7 experiment (vary the reviewer model,
// hold tier, confirm green held, watch cost fall $5.50→$0.42).
//
// COST: this spends real tokens (a grid of live `anchor wave` runs). Run deliberately, NOT in CI.
//
// ── Method ───────────────────────────────────────────────────────────────────────────────────
// For each directive d in the corpus sample:
//   for tier t in [implementer-only, audit, full]:          # the scale-UP axis
//     for reviewerModel m in [balanced, reasoning]:         # the per-role model ablation (extend per role)
//       run `anchor wave` with d pinned to (t, m) in a fresh worktree + node_modules symlink
//       score: pass = (status COMPLETE) && (real `npm test` green) && (no false-COMPLETE)
//       record: pass, cost (reconstruct from phases[].usage × pricing), wall (sum durationMs)
//   oracle(d) = argmin cost over { configs where pass }      # cheapest sufficient
//   regret(d) = cost(classifier_pick) - cost(oracle)         # ≥0 if sufficient
//             + BIG if classifier_pick is INSUFFICIENT       # under-scale penalty (asymmetric)
//
// Report: per-directive { classifier_pick, oracle, sufficient?, regret }, and aggregate
//   - sufficiency rate  = P(classifier pick passes)              # must be ~1.0
//   - exact-oracle rate = P(pick == oracle)
//   - mean over-provision ratio = mean(cost(pick)/cost(oracle) | sufficient)
//   - mean regret
// Feed confirmed oracles back as `oracle-derived` gold in routing-corpus.ts (closing the loop).
//
// ── Reuse the proven harness plumbing ──────────────────────────────────────────────────────────
// The comparison runs already do most of this. To turn this stub into the real thing, lift:
//   - worktree+node_modules setup            (coordination/measurements/compare2 in anchor-cc-poc)
//   - `anchor wave --plan <p> --json`         (one plan item per (directive,tier), tier pinned)
//   - cost reconstruction                     (phases[].usage × {opus,sonnet,haiku} pricing table)
//   - green check                             (real `npm test` per worktree)
//   - per-phase wall                          (phases[].durationMs — already emitted)
//
// TODO(impl): wire the grid loop + scoring. Left as a stub because each cell is a live model run;
// the Layer-1 harness already guards regressions deterministically, and this is the periodic
// ground-truth re-grounding, not a per-commit gate.

import { classifyTier, selectRoleModelClasses } from '../src/index.ts';

// The tiers the oracle search ablates over (the scale-up axis). solo == implementer-only here.
export const ORACLE_TIERS = ['implementer-only', 'audit', 'full'];

// Cheapest-sufficient picker: given scored grid rows {tier, model, pass, cost}, return the oracle.
export function deriveOracle(rows) {
  const passing = rows.filter((r) => r.pass);
  if (!passing.length) return null; // nothing sufficed — directive is harder than the grid
  return passing.reduce((best, r) => (r.cost < best.cost ? r : best));
}

// Asymmetric regret: 0 when the pick is the oracle; the wasted-cost delta when over-scaled but
// sufficient; a large penalty when the pick was INSUFFICIENT (under-scaled → shipped/failed).
export function regret(pickRow, oracle, underScalePenalty = 100) {
  if (!pickRow || !pickRow.pass) return underScalePenalty;
  if (!oracle) return 0;
  return pickRow.cost - oracle.cost;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('routing-oracle: STUB. See the header for the method. It runs a LIVE grid (real tokens) —');
  console.error('wire the grid loop against `anchor wave` before running. classifyTier/selectRoleModelClasses');
  console.error('are importable here so a pick can be compared to the derived oracle.');
  process.exit(2);
}
