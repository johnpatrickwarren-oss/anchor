# Skill: Instrumented-caveat discipline

**Trigger:** Any measurement-emitting artifact (bench report, AC verification table, audit cross-cutting check, spec claim with stipulated parameters) where the emitted value materially diverges from what a reader would infer from the column / AC / claim name. Applies at three checkpoints: spec-author grilling (G3 / G5), Implementer bench / harness drafting, Reviewer right-reasons audit.

## What it is

A documented caveat alongside a single number is insufficient when the caveat materially changes the number's interpretation. The discipline: **emit a parallel measurement of the omitted portion in the same artifact, or rename the column to make the partiality explicit, or widen the column to the full cost — never publish the fraction with only a footnote.**

Headlines anchor. Footnotes don't.

The discipline is structural, not cultural: it turns "the reader will know to read the caveat" into "the artifact carries the caveat alongside the value, in the same table row, indistinguishable from the value itself."

## Why it works

Memorial F sub-rule 4 (pre-existing-property-coherence) says: when a spec claims a behavior should hold, verify it wasn't already documented as the opposite somewhere. Sub-rule 5 — instrumented-caveat discipline — extends this to claims about measurements: when a column/AC/value name suggests one cost class but the measurement captures a fraction of that class, the artifact must make the fraction explicit in its primary surface, not in a parenthetical.

The empirical failure mode this prevents: a reader (downstream consumer, oncall, reviewer) scans the artifact's table or summary, reads "0.6 cores at 72K shards," takes it as production cost, doesn't notice the caveat ten lines below saying "(this is the cross-term floor, not full computeUt)" — and propagates the overoptimistic number into a downstream decision.

The discipline value: in any project, the headline number from a bench / coverage matrix / AC verification table gets quoted in PRs, in pitch decks, in incident postmortems. The caveat doesn't get quoted; the column header does. If the column header lies (or under-reports by 30×, which is functionally the same), the discipline failure compounds across every downstream artifact.

This is methodologically distinct from generic "good documentation" advice. The claim is structural: **a partial measurement with a caveat is a discipline violation by construction**, regardless of how well-written the caveat is. The artifact must instrument the gap, not document it.

## How to apply

### Recognition test

A measurement-emitting artifact triggers this skill if ANY of:

1. **The column / AC / value name suggests a complete cost class** (e.g., "MMD µs/shard", "test coverage", "latency p99") and the implementation captures a subset (e.g., one term of a multi-term U-statistic, branches reached but not paths, request-handler time but not queue time).

2. **The artifact contains a caveat acknowledging the partiality** — anywhere in the header, footer, README, or surrounding documentation — without a corresponding parallel measurement in the same primary surface.

3. **The artifact's headline value, if quoted out of context, would mislead a reader about the cost class** the named measurement represents.

If any condition fires, apply one of three resolutions.

### Three valid resolutions

**Resolution A — Emit both partial and full in the same surface.**

The strongest discipline: rename the existing column to make the partiality explicit (e.g., `mmd_floor_us_per_shard`) and add a new column for the complete measurement (e.g., `mmd_full_us_per_shard`). The cadence table, summary, or cross-cutting AC table grows to expose both numbers side-by-side. Readers who quote the headline see both numbers; the discipline doesn't depend on the caveat being read.

This is the discipline-preferred resolution. Use it when both measurements are tractable in the same harness run.

**Resolution B — Drop the partial; emit only the complete measurement.**

When the partial measurement has no independent value, remove it. The artifact emits only the full cost class under its real name. Use when keeping the partial would add reader-confusion cost greater than its information value.

**Resolution C — Rename the column to make partiality explicit; do not promise the full cost.**

When the full measurement is intractable in the harness (e.g., requires real cluster hardware, requires a multi-day batch run, requires unavailable infrastructure), rename the column to be unambiguous about scope: `mmd_cross_term_floor_us_per_shard` rather than `mmd_us_per_shard`. The AC, the report header, and the column itself all use the same partiality-explicit name. The caveat moves from footnote to identifier.

### Anti-pattern: caveat-as-rescue

A bench / matrix / AC table that publishes:

```
| MMD µs/shard | ... |
|         3.2  | ... |

> Note: the MMD column reports the cross-term floor (m=500 rbf calls), not
> the full computeUt at b=30, m=500. The full cost is ~30× heavier.
```

is a discipline violation regardless of how clearly the note is written. The column header promises one cost class; the value reports another; the gap is documented in prose. Any reader who scans the table and quotes "3.2 µs/shard MMD" has propagated misinformation, and the discipline depends on every reader noticing the prose caveat — which is not enforceable.

The fix is structural (Resolution A, B, or C), not literary.

### When this skill fires

- **Architect, writing the bench/measurement section of a spec:** when a measurement is proposed as a fraction of a named cost class with the intent to caveat, halt and apply Resolution A/B/C at spec time. Do not let the partial-with-caveat shape reach the Implementer brief.
- **Architect, drafting AC criteria:** when an AC asserts a behavior that depends on a stipulated assumption (e.g., "detection rate ≥ X at stipulated bandwidth"), either make the stipulation an AC variable (test across a range) or rename the AC to make the stipulation explicit.
- **Implementer, drafting the harness:** when the implementation reveals that a primitive's full cost is intractable to capture, surface this to TPM as a halt; the architect chooses Resolution A/B/C rather than the Implementer silently capturing a fraction.
- **Reviewer, cross-cutting audit:** check the right-reasons audit table for any verified-AC row where the verification evidence captures a fraction of what the AC name claims; flag as a discipline finding.
- **Memorial Updater:** when this discipline fires in-round, memorialize as a confirmation; when it's discovered post-merge (user reads the headline as production cost), memorialize as a violation with the resolution that brought it into compliance.

### Companion skills

- **Skill 02 — Memorial Accretion.** This skill is Memorial F sub-rule 5; see Memorial F in METHODOLOGY.md for the four-sub-rule table.
- **Skill 08 — Architect Six Practices.** Practice P3.1 (concrete-values) and P4 (per-component claim verification + semantic comparability) cover the spec-time discipline; this skill extends it to harness / bench / AC artifacts at implementation time.
- **Skill 13 — Anti-Self-Confirming Tests.** Self-confirming tests assert what they bind without testing the production behavior; partial-with-caveat measurements report a sub-cost while naming the full cost. Both are structural-claim-vs-actual-implementation gaps caught at the same audit layer.
- **Skill 15 — Prescription-to-AC Coverage.** When a spec prescribes a measurement and the AC captures only a fraction, both Skill 15 (the prescription has no AC binding to the full cost) and Skill 16 (the binding it does have is to a partial measurement) fire.

## Worked example

See [`case-studies/clustersynth-r07-instrumented-caveat.md`](../case-studies/clustersynth-r07-instrumented-caveat.md) for the empirical record. Summary: clustersynth R04 published `mmd_us_per_shard` measuring only the cross-term floor (m=500 rbf calls per shard per window via a single helper). The R04 spec audit sidecar memorialized this as R04.M3 with the caveat documented in the bench report header, the PR description, and the bench README. The user reading the post-R04 summary nonetheless took the headline "0.6 cores at S3" as production cost. R07 corrected by adding a parallel `mmd_full_us_per_shard` column driving the engine's actual `computeUt`, growing the cadence table from 4 to 6 columns so both fraction and full appear in the same row. The 0.6-cores number was 30× under-reporting; the corrected number is 8.3 cores at S3 1s with full MMD, 1.17 cores with R05's sparse sampling, 0.38 cores cheap-detector-only.
