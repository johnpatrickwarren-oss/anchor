# Hybrid Reviewer — Design

**Goal:** Run Opus + Sonnet Reviewer in parallel for audit-tier rounds, merge their findings into a single canonical Reviewer report. Capture both models' complementary biases (Opus: AC-literal precision; Sonnet: procedural compliance) at ~20% cost increase over Opus-only.

**Evidence base:** see EVAL-SONNET-REVIEWER-2026-05-15.md.

## Architecture

```
[Implementer commits SHA-A]
        ↓
┌───────────────────────────┐
│  Hybrid Reviewer stage    │
│                           │
│  ┌─────────────────┐      │
│  │ Opus Reviewer   │ ─┐   │
│  │ → REPORT-opus   │  │   │
│  └─────────────────┘  │   │
│                       ├─→ MERGER → REVIEWER-REPORT-RNN.md
│  ┌─────────────────┐  │      ↓
│  │ Sonnet Reviewer │ ─┘   updates NEXT-ROLE.md + MEMORIAL.md
│  │ → REPORT-sonnet │      │
│  └─────────────────┘      │
└───────────────────────────┘
        ↓
[Memorial-Updater]
```

Both Reviewer sessions run in parallel against the same SHA. Each writes to its own report file (suffixed `-opus.md` / `-sonnet.md`). Merger reads both, deduplicates findings, produces the canonical `REVIEWER-REPORT-RNN.md`.

## Per-session output paths

| Session | Output file |
|---|---|
| Opus Reviewer | `coordination/reviews/REVIEWER-REPORT-RNN-opus.md` |
| Sonnet Reviewer | `coordination/reviews/REVIEWER-REPORT-RNN-sonnet.md` |
| Merger | `coordination/reviews/REVIEWER-REPORT-RNN.md` (canonical) |

The two per-model reports are preserved for audit + future calibration eval.

## Reviewer prompt changes

Add to the Reviewer prompt:

> Write your report to `coordination/reviews/REVIEWER-REPORT-${ROUND}-${MODEL_TAG}.md` (replacing `${MODEL_TAG}` with `opus` or `sonnet` per the variant flag). Do NOT update `NEXT-ROLE.md` or `MEMORIAL.md` — the Merger step that follows handles those updates.

The pipeline passes `MODEL_TAG=opus` or `MODEL_TAG=sonnet` per dispatch.

## Merger prompt

```
You are the REVIEWER-MERGER for round ${ROUND}.

Two parallel Reviewers (Opus + Sonnet) have produced independent reports.
Your job is to merge them into a single canonical report.

Read:
  - coordination/reviews/REVIEWER-REPORT-${ROUND}-opus.md
  - coordination/reviews/REVIEWER-REPORT-${ROUND}-sonnet.md
  - The spec + source + tests (to verify findings)

Produce:
  - coordination/reviews/REVIEWER-REPORT-${ROUND}.md (merged canonical)
  - Updated coordination/NEXT-ROLE.md (STATUS: MERGE-READY or ESCALATE)
  - Append to coordination/MEMORIAL.md

Merger rules:
1. UNION findings — if either reviewer caught it, keep it.
2. DEDUPLICATE — if both reviewers caught the same issue (same file:line OR
   same semantic concern), keep one merged finding tagged "[both]" with
   evidence from each.
3. TAG provenance — every finding ends with [opus] or [sonnet] or [both].
4. VERIFY suspect findings — for any finding flagged by only one reviewer
   where you have low confidence, briefly verify against the actual code
   (re-read the named file:line). If the finding is incorrect, mark it as
   FALSE POSITIVE and explain. Do NOT silently drop findings without
   verification.
5. RE-NUMBER MAJOR/MINOR/OBS sequentially in the merged report.

Routing rule (unchanged):
  CRITICAL exists → STATUS: ESCALATE
  MAJOR or below  → STATUS: MERGE-READY

Use Sonnet (cheap) for the merge — pure aggregation work, no novel reasoning.
```

**Merger cost estimate:** ~$0.60 — reads two ~180-line reports + spec + some source files; produces a similar-sized merged report.

## Cost analysis

| Mode | Per-round cost | Wave (4 audit-tier) | Cost vs Opus-only |
|---|---|---|---|
| Opus-only Reviewer (current) | $6.00 | $24 | baseline |
| Sonnet-only Reviewer | $1.20 | $5 | -80% |
| **Hybrid (Opus + Sonnet + Merge)** | **$7.20** | **$29** | **+20%** |

Hybrid trade: +$1.20/round to gain coverage of both bias categories.

## Wall-clock impact

Parallel dispatch means hybrid wall-clock = max(Opus, Sonnet) + merge ≈ 12 min (vs Opus-only ~10 min). +20% wall-clock per round.

## Implementation steps for run-pipeline.sh

1. Add env var: `HYBRID_REVIEWER=${HYBRID_REVIEWER:-false}` (opt-in initially).
2. Add var: `MODEL_REVIEWER_SECONDARY="claude-sonnet-4-6"` (default).
3. Extract `dispatch_reviewer()` from current single-reviewer call.
4. Add `dispatch_hybrid_reviewer()`:
   - Build prompt with `MODEL_TAG=opus` → write `.prompt-reviewer-opus.md`.
   - Build prompt with `MODEL_TAG=sonnet` → write `.prompt-reviewer-sonnet.md`.
   - Background-launch both via `run_role`.
   - `wait` both PIDs.
   - Build merger prompt → run merger via `run_role` (foreground, Sonnet model).
5. Branch in main pipeline: `if $HYBRID_REVIEWER && [[ $TIER == "audit" ]]; then dispatch_hybrid_reviewer; else dispatch_reviewer; fi`.
6. Update `build_reviewer_prompt()` to accept `$MODEL_TAG` and parameterize output path.
7. Update `commit_*_outputs` flow to know about the new `-opus.md` and `-sonnet.md` artifacts (commit them alongside the canonical).
8. Update `check_escalation()` and any other downstream consumers to read the canonical `REVIEWER-REPORT-RNN.md` only.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Parallel reviewers race on the same NEXT-ROLE.md / MEMORIAL.md → corruption | Reviewer prompts explicitly forbid updating these; merger is the only writer |
| Merger drops a real finding it can't verify | Merger prompt mandates "verify before dropping" + audit trail of FALSE POSITIVE rationale |
| Sonnet's per-machine stamp file races with Opus's | Use inline `--append-system-prompt` for stamp content instead of `.role-stamp` file (already partially refactored) |
| `claude -p` parallel calls hit rate limits | Existing retry logic handles this; expect occasional 30–60s delays on Wave 6+ |
| Cost shock: 20% higher per round | Opt-in via `HYBRID_REVIEWER=true`; default off until validated on 2-3 real rounds |

## Validation plan (before turning on by default)

1. Implement the change with `HYBRID_REVIEWER=true` enabled only manually.
2. Dispatch Wave 6b's first audit-tier round (R58 or R61 depending on what unblocks) with hybrid mode.
3. Inspect: did merger correctly dedupe? Were Opus + Sonnet findings both surfaced? Any false positives?
4. If pass: enable by default for audit-tier (`HYBRID_REVIEWER=${HYBRID_REVIEWER:-true}` for audit-tier; false for full-tier where Architect already provides the second pair of eyes).
5. If fail: roll back; iterate on merger prompt.

## Future extensions

- **Per-tier hybrid policy:** full-tier already has Architect adversarial input; only audit-tier benefits from dual Reviewer. Make hybrid audit-tier-only by default.
- **Sonnet for Memorial-Updater confidence check:** since Sonnet caught Opus's missed procedural violation in R54, a similar Sonnet pass on Memorial entries could catch under-disciplined memorial accretion.
- **Cost-aware sampling:** instead of always-hybrid, run hybrid on 1-in-3 rounds randomly to monitor Sonnet's drift over time without paying the full +20% on every round.
