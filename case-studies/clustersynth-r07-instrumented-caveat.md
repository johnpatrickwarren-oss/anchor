# Case Study — clustersynth R04→R07: instrumented-caveat discipline

_The empirical record motivating [skills/16-instrumented-caveat-discipline.md](../skills/16-instrumented-caveat-discipline.md) (Memorial F sub-rule 5)._

## Project context

[clustersynth](https://github.com/johnpatrickwarren-oss/clustersynth) emits deterministic GB200 / GB300 NVL72 cluster fixtures at four order-of-magnitude scale tiers (S0 = 72 GPU shards → S3 = 72,000 shards) plus a federated-campus shape variant (C0 = 4 × S2 sub-clusters = 28,800 shards). It is the worked example referenced throughout the Anchor pack's documentation as a single-author, multi-round application of the methodology.

The R04 round opened a benchmark of [Tessera](https://github.com/johnpatrickwarren-oss/tessera) (the consumer-side detector engine) against the clustersynth fixtures to answer the user's framing question: *"how much compute is required and how is latency affected as we move up orders of magnitude? Does Tessera actually work at scale?"*

R04 shipped a measurement of detector-pass cost per shard per window. R07, three rounds later, corrected it. The gap between R04's headline and R07's headline — **a factor of ~30×** — is the empirical record this skill is distilled from.

## The R04 measurement

The R04 bench at `tessera/bench/clustersynth-perf.ts` measured per-shard cost of the engine's load-bearing detector primitives. For MMD specifically, it called a custom helper:

```ts
function mmdRbfCrossSum(pool: number[][], live: number[], bw: number): number {
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += rbf(live, pool[i]!, bw);
  }
  return acc / pool.length;
}
```

This evaluates **m = 500 RBF kernel calls per shard per window** — a single "live" vector against each member of the baseline pool. The bench column was named `mmd_us_per_shard`. Empirical value at every scale: **3.2–3.5 µs/shard** on an Apple M5.

The R04 cadence table (4 columns) reported, for S3 (72,000 shards) at 1s cadence: **0.6 cores with MMD on every shard every window**.

## The caveat — and why it didn't save the discipline

The architect knew the bench measured a fraction. The engine's `computeUt` runs three terms:

```ts
export function computeUt(window: number[][], baseline: number[][], params): number {
  let xx = 0;
  for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) if (i !== j)
    xx += rbf(window[i], window[j], params.bandwidth);   // b² − b = 870 evals at b=30
  let xy = 0;
  for (let i = 0; i < b; i++) for (let j = 0; j < m; j++)
    xy += rbf(window[i], baseline[j], params.bandwidth); // b · m = 15,000 evals at b=30, m=500
  const yy = params.baseline_baseline_sum / (m * (m - 1));
  return (xx / (b * (b - 1))) - (2 * xy / (b * m)) + yy;
}
```

The bench's `mmdRbfCrossSum` measured only the `xy` term divided by b — exactly ~32× under the full cost. The architect documented this:

- **MEMORIAL R04.M3** (in clustersynth's coordination tree): *"the MMD column reports the cross-term floor (m=500 rbf calls per shard per window) — the full computeUt over b accumulated windows is materially heavier; the cores estimate is therefore a lower bound on the MMD-dominated regime and is explicitly flagged in the report"*
- **bench/clustersynth-perf.ts report header** (visible at the top of every generated report): *"The cadence table assumes MMD evaluates every shard every window. In practice, sparse sampling (see clustersynth R05) materially changes the cores number"* — note that the caveat addresses sparse sampling but does NOT note the cross-term vs full distinction
- **bench/README.md** (in the tessera repo): *"The MMD column reports the cross-term floor; full computeUt is ~30× heavier"*
- **tessera PR #5 description** (the merge artifact): *"the MMD column reports the cross-term floor (m = 500 rbf calls) ... is therefore a lower bound on the MMD-dominated regime"*

All four caveats described the gap correctly. None of them prevented the discipline failure.

## The failure

After R04 + R05 + R06 closed, the post-round summary highlighted **"0.6 cores at S3 (72,000 shards) at 1s cadence with MMD on every shard every window"** as the load-bearing answer to the user's question.

The user's response, verbatim:

> So, even with MMD on, at S3 levels at 1s cadence, it only requires 0.6 cores? Also, even at S3 end to end is only 655ms to aggregate and provide analysis at 1sec cadence?

The user read the headline as production cost. The four written caveats — in MEMORIAL, in the report header, in the bench README, in the PR description — did not interrupt the headline reading. The summary's mention of "MMD cross-term floor" was treated as a clarifier on what was measured, not as a 30× correction to the number itself.

This is the empirical demonstration of the discipline's load-bearing claim: **headlines anchor; footnotes don't.** The caveats were all true, all visible, and all insufficient.

## The correction

R07 amended R04's bench in a single commit on the same PR branch (#5, `43aedb8`):

1. Renamed `mmdRbfCrossSum` → `mmdRbfCrossSumFloor` for semantic clarity
2. Added `computeUt` to the imports
3. Added a new measurement loop driving full `computeUt(window_b, baseline, mmdParams)` per shard per window at b = 30, m = 500 — the engine's actual production cost class
4. Added a new column `mmd_full_us_per_shard` alongside the renamed `mmd_floor_us_per_shard`
5. Grew the cadence table from 4 columns to 6:
   - `1s — no MMD`
   - `1s — MMD floor` (R04's original column, renamed)
   - **`1s — MMD full`** (R07's correction, bold in the rendered Markdown)
   - `5s — MMD full`
   - `15s — MMD full`
   - `1s — MMD@k=10` (sparse sampling per R05's α-preservation result)
6. Replaced the caveat block with one that directs readers to the **`MMD full` column**, not to a footnote

The empirical numbers post-correction (Apple M5):

| Fixture | Shards | MMD floor µs/shard | **MMD full µs/shard** | Ratio | 1s no MMD cores | **1s MMD full cores** | 1s MMD@k=10 cores |
|---|---:|---:|---:|---:|---:|---:|---:|
| S0 | 72 | 3.2 | **102.1** | 31.8× | 0.0006 | **0.008** | 0.001 |
| S2 | 7,200 | 3.4 | **104.4** | 30.4× | 0.033 | **0.785** | 0.108 |
| C0 | 28,800 | 3.2 | **105.0** | 32.9× | 0.149 | **3.174** | 0.451 |
| S3 | 72,000 | 3.3 | **109.9** | 33.0× | 0.382 | **8.293** | 1.173 |

S3 at 1s with full MMD on every shard every window: **8.293 cores**, not 0.6.

## What the correction proves

Three claims the case study supports:

1. **Caveat-as-rescue is structurally insufficient.** Four written caveats — in the MEMORIAL, report header, README, and PR description — did not prevent a careful reader from anchoring on a 30×-low headline. The fix required restructuring the artifact, not rewriting the caveats.

2. **Parallel measurement in the same surface is enforceable.** The 6-column cadence table cannot be quoted out of context in a way that hides the full-MMD column. The headline now reads "0.38 cores no MMD, 8.3 cores full MMD, 1.17 cores @k=10" rather than "0.6 cores" — the discipline doesn't depend on the reader looking past the column header.

3. **The cost of the correction was small.** R07 amended R04's open PR with a single commit; total Implementer time ~30 min, including running the bench against S0–S3 + C0. The Anchor methodology's round-numbering convention allowed R07 to be a focused corrective deliverable rather than requiring R04 to be reopened or invalidated.

## Pre-prediction calibration

R07's audit sidecar pre-predicted:

| Pre-prediction | Actual | Outcome |
|---|---|---|
| mmd_full µs/shard at p=11, b=30, m=500 on M5: 50–150 µs | 102–110 µs | within band (middle) |
| Floor → full ratio: 25–40× | 30.4–33.0× | within band (centered on algebraic prediction ~32×) |
| S3 cores at 1s full MMD: 5–10 cores | 8.293 | within band |
| S3 cores at 1s MMD@k=10: 0.8–1.5 cores | 1.173 | within band |
| Wall time including S3: 45–90s | 68s | within band |

Every pre-prediction landed within its stated range. The architect's calibration was right because R07's prediction was a product of (counted operations) × (per-operation cost measured in a prior round) × (hardware-class factor measured in a prior round) — see Skill 16 § "Why it works" and MEMORIAL R07.M2 for the discipline lesson on prediction calibration.

## Memorial references

In the clustersynth repository's `coordination/MEMORIAL.md`:

- **R04.M3** — Original architectural choice: bench MMD column is cross-term floor, not full computeUt. Documented the partiality; did not instrument it.
- **R07.M1** — Memorialized caveats must be instrumented, not just documented. The discipline now distilled into Anchor Skill 16.
- **R07.M2** — Structural / arithmetic pre-predictions are the most calibrated (sharpens MEMORIAL R06.M2). R07's predictions landed because every factor was a product of measured constants and algebraic counts.
- **R07.M3** — Amending an open PR with a corrective round is the right discipline shape; close-and-reopen would obscure the R04 → R07 progression.

## Conclusion

The R04 → R07 trajectory is the empirical seed for Memorial F sub-rule 5. The four written caveats across four artifacts were necessary documentation; they were not sufficient discipline. The correction was instrumenting the gap in the artifact's primary surface — not rewriting the documentation.

Future rounds across any project that emit measurements should apply the discipline at spec time: if a column / AC / value will be a fraction of the named cost class, the artifact must publish both fraction and full in the same surface, or rename the column to make the partiality explicit, or widen the column to the full cost. The caveat moves from prose to structure.
