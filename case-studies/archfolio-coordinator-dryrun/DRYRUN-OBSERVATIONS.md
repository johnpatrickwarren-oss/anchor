# Coordinator dry-run — observations against ArchFolio

Companion to [`WAVE-PLAN-01.md`](./WAVE-PLAN-01.md). Records the
methodology gaps surfaced by applying `skills/12-coordinator-role.md` to
ArchFolio's 22 pending rounds. The dry-run was the cheapest way to test
the skill against a real project plan before any multi-track activation.

**Date:** 2026-05-14.
**Skill version tested:** `~/anchor/skills/12-coordinator-role.md` @ canonical main `a17a28c` (post-PR #25).

---

## Headline finding

**D5 strict-form over-serializes when many work units in a domain all
touch migrations.**

skills/12 §Step 2 D5:

> "If both [work units] do [add migrations], they have a serial
> dependency regardless of file overlap — the migration history is
> linear by construction."

Applied to ArchFolio Wave 1, this forces P2.1, P1.1, P1.2, P1.5 into
4 sequential sub-waves (because all four add migrations). The
SEQUENCING-PLAN explicitly intended these as parallel-safe ("Phase 1
— Run in any order"). The conflict: **D5 conflates "linear history"
with "serial dispatch."**

Migration history is linear in the sense that filenames have a
monotonic prefix and the apply order is deterministic. It is NOT
linear in the sense that "two migrations adding entirely independent
tables must dispatch in order." Prisma (and every other modern ORM)
applies migrations in name order at deploy time; it has no problem
with two independent migrations being generated against the same base
schema and merged in either order.

The risk D5 protects against is **conflicting schema changes** —
e.g., A renames a column B then references. Two independent table
additions don't have this risk.

### Refinement proposal

D5 should fire as a serial dependency only when work units have
**actual schema-write conflict**. Test:

> **Test D5 (refined).** Does WU-A's intended migration write to a
> table, column, or constraint that WU-B's intended migration also
> writes? If yes: WU-A → WU-B (serial). If both add migrations but
> against disjoint schema surfaces, they are *contention candidates*
> (D4-like, resolved via worktree + the migration lock primitive)
> rather than strict dependencies.

This recovers Phase-1 parallelism for ArchFolio (4 clusters in Wave
1, with migration-lock arbitration handling the timestamp prefix
contention). The fallback migration lock from skills/12 §Schema
migrations is the right home for this — D5's job is then "flag the
serial cases"; the lock handles "serialize the parallel-safe cases at
file-creation time."

Severity: **methodology change required before any multi-track
activation that includes Phase-1 parallelism.** Defer until the
operator is ready to actually run multi-track; the current strict D5
is correct for sequential operation.

---

## Secondary observations

### 1. D2 surfaced zero unique edges on this PRD

D2 (AC reference) was supposed to catch dependencies where WU-B's AC
mentions WU-A's defined behavior even when no file/output is shared.
For ArchFolio, every D2-firing edge was caught earlier by D1.

This is **not a defect**. ArchFolio's PRD has explicit data-flow
language ("contract is signed" → "project record created"), so D1
catches everything. PRDs without explicit data-flow language (e.g.,
heavy interface-contract PRDs where shared behavior is the
dependency, not shared state) may surface D2-unique edges. Worth
noting in the skill that D2 is a backup test whose value varies with
PRD style.

### 2. D3 surfaced zero edges on this PRD

ArchFolio's PRD has clean module boundaries (Modules 1–8) and
explicit anti-scope. D3 found nothing to fire on. Same caveat as D2 —
D3 may be more useful on PRDs without clean module separation.

### 3. Foundation heuristic correct but threshold-sensitive

"Foundation if feeds ≥3 other WUs" catches WU-P2.1 (8 downstream)
cleanly. For larger projects, secondary nodes with 3–4 downstream
edges might over-qualify as foundations. A more discriminating
heuristic: "foundation if feeds ≥3 downstream WUs AND those
downstream WUs are in 2+ different domains/modules." WU-P2.1 passes
both (8 downstream across 3 modules: CON chain, POR chain, NOT
chain). Not urgent — flag for future refinement.

### 4. Wave 6 has 11 clusters; operationally unwieldy

The DAG correctly identifies 11 WUs as fully parallel-safe after
Phase 2 closes. But 11 concurrent Coordinator-dispatched clusters is
a real-world overload — operator review burden, log volume,
multi-track-status.json contention. A real Coordinator should
**heuristically sub-wave** large wave-N parallel sets into smaller
chunks (suggested: ≤4–5 per wave) for operational sanity.

The skill currently treats wave boundaries as deterministic from the
DAG. A "max-parallelism-per-wave" heuristic should be added — either
as a hard cap in `skills/12-coordinator-role.md` §Step 5 or as a
configurable parameter in `coordination/multi-track-config.json`
(referenced in the arbitration section as a future extension).

### 5. The "in flight" round is hard to represent

WU-P1.4 (FR-ACC-05, R39 currently running on the project's serial
pipeline) sits awkwardly in a dry-run wave plan. It's neither
"completed" nor "to be dispatched" — it's already mid-execution
outside the wave plan's authority. The skill doesn't address how a
Coordinator picks up a project mid-stride (i.e., starts coordinating
when some rounds have already shipped serially).

This isn't relevant for new-project Coordinator dispatch but matters
for "convert a serial project to multi-track partway through." A note
in skills/12 §Coordinator scope clarifying "Coordinator assumes a
clean start; mid-project conversion requires a separate transition
protocol (TBD)" would close this ambiguity.

---

## What worked well

- **Step 1 (work unit extraction) collapses naturally to existing
  SEQUENCING-PLAN rounds.** No re-decomposition needed; the PM's
  round groupings ARE the work units. Confirms the skill's "deterministic
  extraction from PRD structure" promise.
- **D1 alone catches the vast majority of edges.** 13 of 13 unique
  edges in ArchFolio came from D1. D5 found 8 migration WUs; D4 found
  3 contention groups. Step 2 produces high-signal output on the first
  pass.
- **Foundation identification correctly named P2.1.** The "feeds ≥3
  others" rule cleanly distinguishes P2.1 from non-foundations even
  before pruning by domain count.
- **Tier classification priors from SEQUENCING-PLAN held up under the
  skill's A/S/Z rubric in every case.** No re-classification needed.
- **Pre-emit grilling caught the D5 over-serialization issue.** The
  grilling checkbox "no unstated assumptions" forced the question —
  proving the discipline is doing its job at the dry-run layer too.

---

## Recommended methodology actions

In priority order (urgency):

1. **Refine D5** (headline finding) — distinguish "migration history
   is linear" from "migration dispatch must be serial." Update
   skills/12 §Step 2 + §Schema migrations to align. Defer until
   multi-track activation is imminent.
2. **Add max-parallelism-per-wave heuristic** to §Step 5. Cap default
   at 5; configurable per project. Closes the Wave 6 problem cheaply.
3. **Clarify mid-project conversion** in §Coordinator scope. One
   sentence. "Coordinator assumes a clean start" is the right
   default; explicit out-of-scope close.
4. **Note D2/D3 are backup tests** whose value varies with PRD style.
   One sentence in §Step 2 preamble. Avoids future Coordinators
   wondering why D2/D3 fire so rarely.
5. **Refine foundation heuristic** with the "feeds ≥3 across 2+
   domains" tightening. Not urgent — current rule works for
   ArchFolio. Promote when a project surfaces a false-positive
   foundation.

(1) is methodology-blocking. (2)–(5) are quality refinements;
batchable into one follow-up canonical PR.

---

## Process notes

- Dry-run wall time: ~30 minutes (read PRD + sequencing plan, apply
  Step 1–5, draft both files).
- Output deliverable: `WAVE-PLAN-01.md` (a real Coordinator artifact
  shape, populated as a real session would) +
  `DRYRUN-OBSERVATIONS.md` (this file).
- Zero modifications to ArchFolio. Read-only access throughout.
- Canonical methodology unchanged by the dry-run itself; the
  recommended actions above land via separate canonical PRs when the
  operator chooses to act on them.

---

## Post-execution observations (2026-05-15)

This file's original content above was written PRE-execution as a Coordinator
dry-run. Below: validated observations after Waves 5, 6a, and 6b actually ran
through the pipeline + hybrid Reviewer real-world test. Updates and
corrections to the predictions above are explicit.

### 1. Multi-track parallel dispatch worked end-to-end at 4–5 cluster scale

Waves 5 (4 audit clusters), 6a (5 clusters incl. R56-full), and 6b (3 audit
clusters) ran via in-session Option-3 dispatch. Zero rate-limit retries
across the 12 dispatched cluster pipelines. Natural finish-time spread
(Implementer wall-times 32–43 min) provided organic load smoothing — the
projected staggered-dispatch (90s inter-cluster delay) was NOT needed at
3–5 concurrent clusters and probably becomes relevant only at 6+.

**Update to original observation #4 ("Wave 6 has 11 clusters; operationally
unwieldy"):** prediction confirmed. Wave 6 was split organically into 6a
(5 clusters) + 6b (5 clusters, 3 dispatched) + 6c (1 cluster, deferred).
The 5-cluster cap is the right default. Recommend canonical Step 5 update
to make this explicit.

### 2. Hybrid Reviewer (Opus + Sonnet + merger) — first production validation

A meta-experiment ran during this case-study cycle: the Reviewer role was
upgraded to dispatch Opus + Sonnet IN PARALLEL, with a Sonnet-driven merger
consolidating findings. Validated across 4 audit-tier rounds (R59/R61/R62/R64).

Observed outcome:
- **Zero races** despite parallel execution (per-invocation `mktemp .role-stamp`
  prevented file conflicts; reviewers wrote to `-opus.md` / `-sonnet.md`
  suffixed paths; only the merger updated NEXT-ROLE.md + MEMORIAL.md).
- **Severity-max promotion fired correctly**: R59 had 2 MAJORs that Opus
  caught and Sonnet classified as MINOR. The merger correctly promoted both
  to MAJOR rather than averaging or letting Sonnet's lower severity stand.
- **Meta-validation moment in R64-fix-cycle**: Opus caught a MAJOR (incomplete
  body-content assertion in a route-handler test) that Sonnet marked PASS.
  The MAJOR was specifically the SAME class of issue R64 was meant to FIX
  (R54 MAJOR-1, anti-self-confirming-test pattern). Without hybrid, the
  fix-cycle would have shipped a re-incarnation of the bug it claimed to
  close.
- **Cost**: +20% per audit-tier round (~$8.58 with hybrid vs ~$7 Opus-only),
  +10% wall-clock per round (merger runs sequentially after the parallel
  reviewers; the parallel stage costs ~0 over slowest-reviewer baseline).

The pattern is now canonical: `integrations/superpowers-claude-code/run-pipeline.sh`
ships hybrid Reviewer opt-in (`HYBRID_REVIEWER=true`). Methodology docs:
`case-studies/archfolio-coordinator-dryrun/EVAL-SONNET-REVIEWER-2026-05-15.md`
and `HYBRID-REVIEWER-DESIGN.md`.

### 3. Real cost numbers (finally measured, not estimated)

| Component | Per audit-tier round |
|---|---|
| Implementer (Sonnet 4.6) | ~$0.44 |
| Reviewer Opus 4.7 | ~$6.00 (cache_read ~1.3M tokens — Reviewer reads full src/ + tests/) |
| Reviewer Sonnet 4.6 (hybrid only) | ~$1.20 |
| Merger Sonnet 4.6 (hybrid only) | ~$0.50 |
| Memorial Updater (Sonnet 4.6) | ~$0.44 |
| **Audit-tier round, Opus-only Reviewer** | **~$6.88** |
| **Audit-tier round, hybrid Reviewer** | **~$8.58** |
| **Full-tier round** | **+$2.18 for Architect (Opus)** |

Earlier estimates ($3.06/round) were inflated — they assumed Reviewer
input was similar to Architect input. In practice the Reviewer reads
substantially more context (full src/ + tests/) and the cost is dominated
by Opus's $0.30/MTok cache_read on the 1M-context window.

### 4. macOS sleep killed unattended overnight execution

Wave 6a's overnight run paused 01:01 → 07:48 (6.7 hours) despite
lid-open + AC power + `caffeinate` invocation. Morning `ps aux | grep
caffeinate` showed no overnight caffeinate process — it had died.

Root cause confirmed via `pmset -g`: Claude Code asserts sleep-prevention
while actively working, but releases the assertion when idle (waiting for
background pipeline events). With caffeinate dead AND Claude idle, macOS
slept the system; the entire Claude Code process tree was SIGSTOP'd; all
5 background pipelines froze until user wake.

**Operational learning** (saved to user-memory):
- Run `caffeinate -i -d -s` via `nohup` + `disown` from a terminal
  OUTSIDE Claude Code so it survives parent-shell death.
- Add `sudo pmset -a sleep 0 displaysleep 0 disksleep 0 powernap 0`
  as system-level backup.
- Never use `caffeinate -t <seconds>` for overnight runs.

Implication for Anchor: `anchor-overnight.sh` or any future unattended-run
helper should print a pre-flight checklist surfacing these requirements.

### 5. e2e file convergence triggered merge conflicts (Wave 6a) but resolved organically (Wave 6b)

Wave 6a: all 4 audit-tier clusters extended `tests/e2e/admin.smoke.spec.ts`.
Each cluster's branch had its own new `test()` block at the same insertion
line; sequential merges produced one UNION-resolvable conflict per cluster.

Wave 6b: 3 audit-tier clusters wrote to *disjoint* e2e files
(`quote-revision.spec.ts`, `status-link.spec.ts`,
`admin.milestones.smoke.spec.ts`). Zero merge conflicts.

The Wave 6b pattern suggests Implementers naturally separate when scope is
well-bounded; the Wave 6a pattern emerged because all 4 scopes touched the
"admin smoke" surface. **Recommendation for Coordinator step 4:** cluster
scope authoring should explicitly call out the e2e file each cluster will
write to; if two clusters propose the same file, surface that for the
operator to either re-route or accept the merge cost.

### 6. CLAUDE.md class umbrella consolidation became its own discipline

Over the project lifetime, archfolio's CLAUDE.md accumulated 82 REINFORCED
lines totaling ~85 KB (~21k tokens loaded into every role-session). Three
themes had accumulated 5+ variant-specific reinforcements each:

- `prescription-to-AC-coverage` — 7 variants → consolidated into 1 umbrella
- `PRD-conjunction-cross-check` — 6 variants → consolidated into 1 umbrella
- `anti-self-confirming-test` — 5 variants → 2 umbrella entries (Architect +
  Implementer) preserved; 3 newer variants archived

A new analyzer tool (`scripts/analyze-claude-md.sh`) detects these
candidates mechanically via theme extraction + canonical-name normalization
+ count threshold (≥5 = umbrella candidate).

Both consolidated umbrellas have now been promoted to canonical skills:
`skills/14-prd-conjunction-cross-check.md` and
`skills/15-prescription-to-ac-coverage.md`.

**Lifecycle pattern** (now canonical):
1. Variant-specific reinforcement lands in project CLAUDE.md when first observed.
2. After 5+ variants, run analyzer → flagged as umbrella candidate.
3. Operator (or Coordinator) writes single class umbrella in CLAUDE.md.
4. Variants archived verbatim to `coordination/REINFORCEMENT-ARCHIVE.md`
   under a `§<theme>-class` heading for traceability.
5. If the pattern generalizes beyond one project, promote to anchor canonical
   skill (this case).

CLAUDE.md size after consolidation: 71.9 KB (−15.7%), 68 REINFORCED lines (−17%).

### 7. PRD FRs not all MVP-blocking (architectural reframing)

R56 (supplier catalog API) + R63 (QuickBooks integration) were originally
slated for Wave 6a + 6c. Mid-execution, the operator reframed both as
"end-user-credentialed" features: each firm using ArchFolio connects its
own supplier and accounting accounts via per-firm OAuth; ArchFolio doesn't
centrally hold these credentials.

R56 ESCALATEd cleanly at the Architect HALT discipline; R63 wasn't
dispatched. Wave 6b's 2 dependent clusters (R58 price snapshot, R60
price-change alerts) stay deferred with R56.

**Methodology observation:** the PRD-driven plan doesn't always know which
FRs are MVP-blocking. The Coordinator role should reserve room for mid-
execution architectural reframings without treating them as plan failures.
A decision-doc artifact (`coordination/DECISION-YYYY-MM-DD-*.md`) captures
the rationale cleanly; the PRD itself doesn't need to change.

### Recommended methodology actions (post-execution refresh)

Picking up the original list at the top of this file and updating status:

1. **~~Activate multi-track sequence~~** — DONE. Validated across Waves 5/6a/6b.
2. **~~Add max-parallelism-per-wave heuristic~~** — held at 5; should land in
   canonical Step 5 documentation now.
3. **Clarify mid-project conversion** — still open. Worth a clarifying
   sentence in §Coordinator scope.
4. **~~Note D2/D3 are backup tests~~** — still open; one-sentence update.
5. **Refine foundation heuristic** — still open; not urgent.

**New actions surfaced by Waves 5/6a/6b:**

6. **e2e-file ownership in cluster scope template** (per §5 above) — add a
   one-line "this cluster's e2e file: tests/e2e/<file>.spec.ts" to the
   cluster scope template so the Coordinator can detect convergence at
   plan time.
7. **Hybrid Reviewer default for audit-tier** — currently opt-in. With 4
   rounds of validation, recommend defaulting `HYBRID_REVIEWER=true` for
   audit tier; full tier stays Opus-only (Architect is the second pair of
   eyes). Single-line change to canonical `run-pipeline.sh`.
8. **Unattended-overnight discipline** — surface caffeinate + pmset
   requirements in any future `anchor-overnight.sh` helper. Pre-flight
   check that runs at dispatch time before the operator walks away.
9. **Mid-execution decision-doc convention** — promote the
   `coordination/DECISION-YYYY-MM-DD-*.md` pattern to canonical. Used in
   archfolio for the R56/R63 end-user-credentialed reframe; pattern is
   general.

Items 6–9 are quality refinements; batchable into one follow-up canonical
PR.
