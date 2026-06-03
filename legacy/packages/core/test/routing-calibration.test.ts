// Layer-3 calibration: is classifyTier's CONFIDENCE trustworthy? A deterministic classifier
// returns a fixed confidence per matched rule (0.90 coordinator, 0.85 full, 0.80 implementer-
// only, 0.75/0.70 audit, 0.50 default). Calibration asks: among cases the classifier reported
// at confidence c, how often was it right? Well-calibrated ⇒ accuracy ≈ c. The gap tells us
// where to TRUST the heuristic vs fall back to a model tiebreaker (the documented escape hatch).
//
// Metric: ECE (expected calibration error) = Σ (n_bucket/N) · |accuracy_bucket − confidence_bucket|.
// Truth = gold tier (oracle-derived where available). Probes excluded (their gold is ideal, not
// confirmed). Cheap — pure functions, no live runs; this is the machinery, validated on the
// current corpus and ready to scale as the corpus grows + gets oracle-grounded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTier } from '../src/index.ts';
import { ROUTING_CORPUS } from './routing-corpus.ts';

interface Bucket { conf: number; n: number; correct: number; }

function calibration(cases: typeof ROUTING_CORPUS) {
  const byConf = new Map<number, Bucket>();
  for (const c of cases) {
    const { tier, confidence } = classifyTier(c.directive);
    const b = byConf.get(confidence) ?? { conf: confidence, n: 0, correct: 0 };
    b.n++; if (tier === c.goldTier) b.correct++;
    byConf.set(confidence, b);
  }
  const buckets = [...byConf.values()].sort((a, b) => b.conf - a.conf);
  const N = cases.length;
  const ece = buckets.reduce((s, b) => s + (b.n / N) * Math.abs(b.correct / b.n - b.conf), 0);
  return { buckets, ece, N };
}

test('routing calibration — confidence tracks accuracy (ECE + reliability report)', () => {
  const clear = ROUTING_CORPUS.filter((c) => !c.tags?.includes('probe'));
  const { buckets, ece, N } = calibration(clear);

  console.log('\n  reliability (confidence → observed accuracy):');
  console.log('    conf   n   acc    gap');
  for (const b of buckets) {
    const acc = b.correct / b.n;
    console.log(`    ${b.conf.toFixed(2)}  ${String(b.n).padStart(2)}  ${acc.toFixed(2)}  ${(acc - b.conf >= 0 ? '+' : '') + (acc - b.conf).toFixed(2)}`);
  }
  console.log(`  ECE = ${ece.toFixed(3)} over ${N} cases`);

  // The top-confidence rule (0.90 coordinator markers) is unambiguous → must be perfect.
  const top = buckets.find((b) => b.conf === 0.90);
  if (top) assert.equal(top.correct, top.n, 'coordinator (0.90) should be 100% accurate');
  // No HIGH-confidence bucket may be badly wrong (over-confidence is the dangerous miscalibration).
  for (const b of buckets) if (b.conf >= 0.8) assert.ok(b.correct / b.n >= 0.7, `bucket ${b.conf} accuracy ${(b.correct / b.n).toFixed(2)} too low for its confidence`);
  // Aggregate calibration within a loose bound (small corpus → noisy; tighten as it grows).
  assert.ok(ece <= 0.3, `ECE ${ece.toFixed(3)} exceeds 0.30 — confidence poorly tracks accuracy`);
});

test('routing calibration — the 0.50 default bucket is the model-tiebreaker candidate set', () => {
  // The default (no rule matched → full @ 0.50) is the deliberately-low-confidence escape hatch.
  // It should be a MINORITY of the corpus (most directives match a real rule) and its members are
  // exactly the cases a Layer-2 model tiebreaker would adjudicate. Report them.
  const clear = ROUTING_CORPUS.filter((c) => !c.tags?.includes('probe'));
  const defaults = clear.filter((c) => classifyTier(c.directive).confidence === 0.50);
  console.log(`\n  default-confidence (0.50) cases — tiebreaker candidates: ${defaults.length}/${clear.length}`);
  for (const c of defaults) console.log(`    ${c.id}: "${c.directive.slice(0, 50)}" → gold ${c.goldTier}`);
  assert.ok(defaults.length / clear.length < 0.5, 'over half the corpus hit the default — the heuristic is under-matching');
});
