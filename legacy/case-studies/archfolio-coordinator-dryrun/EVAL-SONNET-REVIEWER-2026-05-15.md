# Eval: Sonnet vs Opus for the Reviewer role (audit-tier)

**Date:** 2026-05-15
**Goal:** Determine whether Sonnet 4.6 can replace Opus 4.7 as the Reviewer for audit-tier rounds without unacceptable quality loss.
**Method:** Phase 1 retroactive replay — re-run Sonnet Reviewer against the exact same code state (SHA-A) and inputs the original Opus Reviewer saw, for 3 historical audit-tier rounds. Compare reports.

## Sample

| Round | Cluster | Reviewer-input SHA | Original Opus findings |
|---|---|---|---|
| R53 | wu-p3-1 (quote PDF + CSV export) | b2bf912 | 3 MAJOR + 6 MINOR + 2 OBS |
| R54 | wu-p3-2 (signed contract PDF) | af60b8f | 1 MAJOR + 4 MINOR + 2 OBS |
| R55 | wu-p3-3 (material price CSV import) | c7da894 | 2 MAJOR + 7 MINOR + 3 OBS |

## Sonnet Reviewer cost + duration (3 parallel runs)

| Round | Cost | input | cache_read | cache_creation | output | duration |
|---|---|---|---|---|---|---|
| R53 | $1.30 | 19 | 1,323,962 | 109,333 | 32,631 | 8.9 min |
| R54 | $1.23 | 20 | 1,484,897 | 97,432 | 28,123 | 9.8 min |
| R55 | $1.10 | 15 | 963,836 | 93,974 | 30,541 | 8.3 min |
| **Total** | **$3.63** | | | | | |

**Estimated Opus equivalent:** ~$6/round × 3 = ~$18. Sonnet is ~5× cheaper.

## Findings comparison

### R53 (quote PDF + CSV export)

| Reviewer | MAJOR | MINOR | OBS | Total |
|---|---|---|---|---|
| Opus | 3 | 6 | 2 | 11 |
| Sonnet | 1 | 5 | 2 | 8 |

**Overlap:** Sonnet's MAJOR-1 (audit gating self-confirming) ≈ Opus's MAJOR-2.

**Opus-only:** Route handlers not exercised by test (MAJOR-1); TDD-ordering RED-commit doesn't establish RED (MAJOR-3).

**Sonnet-only:** `.toString()` vs `.toFixed(2)` spec divergence (MINOR-5).

### R54 (signed contract PDF)

| Reviewer | MAJOR | MINOR | OBS | Total |
|---|---|---|---|---|
| Opus | 1 | 4 | 2 | 7 |
| Sonnet | 3 | 2+ | TBD | 5+ |

**Overlap:** Sonnet's MAJOR-2 (AC-R54-02 test prescription change) ≈ Opus's MAJOR-1.

**Sonnet-only (CRITICAL FINDING):** Sonnet's MAJOR-1 flagged that **Q-R54-SPEC.md did not exist at the SHA the Reviewer saw**. Verified: the spec file was created in the subsequent Memorial-Updater commit (`5d982f0`), AFTER the Reviewer ran. The original Opus Reviewer reviewed R54 with NO spec file present AND did not flag this procedural violation. This is a real bug in Opus's review that Sonnet caught.

**Sonnet-only:** SHA-A attestation unfilled (MAJOR-3).

### R55 (material price CSV import)

| Reviewer | MAJOR | MINOR | OBS | Total |
|---|---|---|---|---|
| Opus | 2 | 7 | 3 | 12 |
| Sonnet | 1 | 4 | 2 | 7 |

**Different MAJORs entirely:**
- Opus MAJOR-1: `lastUpdatedAt` conditional update vs spec §2.3 literal (spec-conformance)
- Sonnet MAJOR-1: Description uniqueness collision unhandled, can throw unhandled exception (correctness)

Both are real issues. Sonnet's is arguably more impactful (production crash risk). Opus's is more discipline-focused.

## Pattern across all 3 rounds

**Sonnet's biases:**
- Strong on **procedural / structural completeness** (missing spec, missing SHA-A, schema-vs-migration drift)
- Strong on **correctness risks** (unhandled exceptions, semantic incorrectness)
- Weaker on **AC-literal narrowings** and **anti-self-confirming-test deep analysis**

**Opus's biases:**
- Strong on **AC-literal narrowings**, **prescription-to-AC binding gaps**, **right-reasons audit depth**
- Weaker on **procedural compliance** (missed R54's missing spec file entirely)

**The reviews catch different *categories* of issue, not different *qualities* of the same issues.** Neither is strictly better; they are complementary.

## Implication

A hybrid dual-Reviewer (Opus + Sonnet in parallel, findings merged) catches MORE real issues than either alone, at ~20% cost increase over Opus-only. This is the recommended strategy.

See HYBRID-REVIEWER-DESIGN.md for proposed implementation.

## Reproducibility

Sonnet Reviewer reports preserved at:
- `coordination/eval-sonnet-reviewer/REVIEWER-REPORT-R53-sonnet.md`
- `coordination/eval-sonnet-reviewer/REVIEWER-REPORT-R54-sonnet.md`
- `coordination/eval-sonnet-reviewer/REVIEWER-REPORT-R55-sonnet.md`

Each was generated with:
```bash
claude -p "<reviewer-eval-prompt>" \
  --model claude-sonnet-4-6 \
  --output-format json \
  --exclude-dynamic-system-prompt-sections \
  --append-system-prompt "$(cat CLAUDE.md)" \
  --max-turns 50 \
  --permission-mode bypassPermissions
```

Run from a temp worktree at the Reviewer-input SHA. CLAUDE.md from the worktree's historical state (not main's current).
