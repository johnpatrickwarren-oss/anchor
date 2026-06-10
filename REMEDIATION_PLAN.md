# Anchor — Repository Review & Remediation Plan

- **Date:** 2026-06-10
- **Commit reviewed:** `267d045` (default branch, fresh clone of `github.com/johnpatrickwarren-oss/anchor`)
- **Reviewer:** independent code/content review (full repo: maintained docs + `legacy/` archive)

## Summary

Anchor's maintained surface (README, `DISCIPLINES.md`, `PRD-INTERVIEW.md`, `design/`,
`templates/project-trail/`) is in good shape: internally consistent, well-cross-linked, no
committed secrets, and no CI/workflow attack surface (there is no `.github/` at all). The issues
found there are documentation-consistency items (a stale "five disciplines" count in an accepted
ADR, stale pre-archive paths in ADR-0001).

The bulk of the findings are in `legacy/` — which the repo explicitly labels archived and
unmaintained, but also claims "it still runs from here" (`legacy/README.md`). That claim is
partly false today: the round-finalizer fails out-of-the-box on the default scaffold with a
misleading error, its attestation commit silently misses untracked coordination files, a lint
gate fails open when lint cannot run, one bundled smoke test fails on a fresh clone, one TS
validator crashes unconditionally (`__dirname` in ESM + missing fixtures), one unit test in
`@anchor/core` was broken by the move of the workspace under `legacy/`, and `run-pipeline.sh`
references a helper script (`verify-wave-aggregate.sh`) that does not exist anywhere in the repo.

Test suites were run (see Appendix): **@anchor/core 133/134**, **@anchor/cli 42/42**,
**@anchor/runtime-agent-sdk 34/34**, shell smoke tests **4/5**, harness gate test **pass**,
`impl-model-select-validate` **5/5**, `tier-router-validate` **crash**.

Severities below already account for the legacy/unmaintained context; "High" items are ones that
contradict the repo's own claims (attestation integrity, "still runs") or fail deterministically.

---

## Critical

*None found.* No committed secrets (`ANTHROPIC_API_KEY` appears only as env-var reads and a
stubbed `sk-ant-test` in tests), no CI workflows to compromise, no malicious links.

---

## High

### H1. `finalize-round.sh` fails on every default scaffold — missing-pathspec `git diff` is fatal and misreported
- **Files:** `legacy/integrations/superpowers-claude-code/finalize-round.sh:109-121` (and `:179` is safe only because it uses `--`); duplicate copy `legacy/integrations/superpowers-claude-code/scripts/finalize-round.sh:80-93`
- **Problem:** Step 2 runs `git diff --quiet src/ tests/ prisma/` (no `--` separator). When any of
  those directories is absent from the working tree, git exits **128**
  (`fatal: prisma/: no such path in the working tree`), stderr is discarded by `2>/dev/null`, and
  the script misreports **"Uncommitted changes in source dirs"** and aborts.
- **Evidence:** Verified empirically: in a fresh repo with only `src/`,
  `git diff --quiet src/ tests/ prisma/` → exit 128. `new-project.sh` scaffolds `src/` and
  `tests/` but **not** `prisma/`, so the default scaffold + default `SOURCE_DIRS` always hits
  this. The error message then sends the operator chasing phantom uncommitted changes.
- **Remediation:** Use `git diff --quiet -- "${SOURCE_DIRS[@]}"` (and same for `--cached` and
  `--name-only` invocations), or filter `SOURCE_DIRS` to existing paths first; stop suppressing
  stderr so a real git failure is distinguishable from a dirty tree.

### H2. Attestation commit (SHA-A) silently excludes untracked coordination files
- **Files:** `legacy/integrations/superpowers-claude-code/finalize-round.sh:133-151`; duplicate `scripts/finalize-round.sh:103-128`
- **Problem:** Step 3 decides whether anything needs committing via
  `git diff HEAD -- coordination/ …` (ignores untracked files) and
  `git status --porcelain … | grep -v "^??"` (explicitly drops untracked files). If the round's
  only coordination changes are **new files** — exactly what a round produces
  (`coordination/specs/Q-RNN-SPEC.md`, `reviews/REVIEWER-REPORT-RNN.md`,
  `logs/ROUND-RNN-SUMMARY.md`) — the script prints "Nothing to commit", sets SHA-A to current
  HEAD, and the new artifacts are never committed, while the script still reports the round
  "finalized cleanly / STATUS: READY". This defeats the script's stated purpose (the two-commit
  SHA-attestation of coordination artifacts).
- **Evidence:** `grep -v "^??"` at `finalize-round.sh:134` / `scripts/finalize-round.sh:105`; the
  `git add coordination/ …` branch is unreachable when only untracked files exist because all
  three emptiness checks pass.
- **Remediation:** Include untracked files in the change detection (e.g.
  `git status --porcelain coordination/ "${CLAUDE_PATHS[@]}"` *without* the `grep -v "^??"`
  filter, or `git add` first and then test `git diff --cached --quiet`).

---

## Medium

### M1. `@anchor/core` test suite has a real failure — broken by the move to `legacy/`
- **File:** `legacy/packages/core/test/citation.test.ts:69-74`
- **Problem:** The test resolves `packages/core/package.json` at `HEAD` via
  `gitCitationResolver(process.cwd())` (which runs `git show SHA:path` with paths relative to the
  **repo root**). When the workspace was archived under `legacy/`, the in-repo path became
  `legacy/packages/core/package.json`, so the resolver correctly returns `null` and the test
  fails: `null !== '{'`.
- **Evidence:** Ran `node --test test/*.test.ts` in `legacy/packages/core`: **133 pass / 1 fail**,
  failing test `gitCitationResolver: null on bogus SHA; resolves a real committed file at HEAD`.
  Resolver implementation at `legacy/packages/core/src/gates/index.ts:144-159` is correct.
- **Remediation:** Update the test path to `legacy/packages/core/package.json`, or derive the
  prefix dynamically (`git rev-parse --show-prefix`).

### M2. `tier-router-validate.ts` crashes unconditionally — `__dirname` in an ES module + missing fixtures
- **File:** `legacy/integrations/superpowers-claude-code/scripts/tier-router-validate.ts:27,33,50`
- **Problem:** The package is `"type": "module"` (`legacy/integrations/superpowers-claude-code/package.json`),
  so `__dirname` is undefined → `ReferenceError: __dirname is not defined in ES module scope` on
  every run. Even if fixed, it loads `scripts/tier-router-fixtures/corpus.json`, a directory that
  does not exist anywhere in the repo (also cited by `scripts/tier-router-criteria.md:76`), and
  line 50 invokes `tier-router.js` (only `tier-router.ts` is shipped).
- **Evidence:** `node scripts/tier-router-validate.ts` → ReferenceError (verified). `find` shows
  no `tier-router-fixtures/` directory. The sibling `impl-model-select-validate.ts` uses the same
  pattern correctly and passes (5/5).
- **Remediation:** Replace with `const __dirname = dirname(fileURLToPath(import.meta.url))` (as
  `legacy/prototypes/verification-harness/harness.mjs:33` already does); commit the
  `tier-router-fixtures/corpus.json` corpus or retarget the validator at the existing fixtures;
  point line 50 at `tier-router.ts`.

### M3. `check-lint-baseline.sh` fails open when lint cannot run; its bundled smoke test fails on a fresh clone
- **Files:** `legacy/integrations/superpowers-claude-code/scripts/check-lint-baseline.sh:30-43`;
  test `legacy/integrations/superpowers-claude-code/tests/scripts/check-lint-baseline.sh.test.sh:27-35`
- **Problem:** `npm run lint 2>&1 || true` swallows total failure (no `package.json`, no `lint`
  script, npm missing). With no `N problem` summary line, the script reports
  `0 errors, 0 warnings` and **exits 0** — a regression gate that passes when the linter never
  ran. The bundled test then asserts "real lint has warnings", which is environment-dependent and
  fails in this clone.
- **Evidence:** Ran the test suite: `FAIL: Expected non-zero exit with strict baseline`
  (4/5 shell smoke tests pass; this one fails). The script printed `Lint result : 0 errors, 0 warnings`
  although `npm run lint` errored.
- **Remediation:** Distinguish "lint ran clean" from "lint did not run": check npm's exit code /
  detect `npm ERR!` in output and exit 1 with a clear message. Make the smoke test self-contained
  (inject a fake lint output) instead of depending on the host project's lint state.

### M4. Hybrid-Reviewer degraded path never records a routing decision (CRITICAL findings can't escalate)
- **File:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:1544-1550` (fallback), `:1249-1259` (per-model reviewers forbidden from routing)
- **Problem:** In hybrid mode, both per-model reviewers are instructed **not** to update
  `NEXT-ROLE.md` / `MEMORIAL.md` — the merger is "the sole writer" of the routing decision. But
  when the Sonnet reviewer fails, the fallback copies the Opus report to the canonical path and
  **skips the merger** (`return 0`). Nobody applies the routing rule
  (CRITICAL → ESCALATE / else MERGE-READY), so a CRITICAL finding in the Opus report does not
  stop the pipeline; the Memorial-Updater then runs and the round closes as if reviewed clean.
- **Remediation:** In the degraded path, parse the Opus report for `CRITICAL` and set
  `STATUS: ESCALATE`/`MERGE-READY` accordingly (or run the merger against the single report).

### M5. `run-pipeline.sh` is silently cwd-dependent — split-brain paths if not invoked from the project root
- **File:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:298-299` (`mkdir -p coordination/logs`, `ROUTING_LOG`), `:218,244,272` (`node scripts/*.ts`), `:825-828` (`scripts/verify-wave-aggregate.sh`), `:1547` (`cp coordination/reviews/...`)
- **Problem:** Most paths are anchored to `$PROJECT_ROOT` (derived from the script's location),
  but the routing log, the selector invocations, the wave-gate verifier, and the hybrid fallback
  `cp` use cwd-relative paths. Invoked via an absolute/relative path from any other directory,
  the pipeline writes logs and reads selectors in the wrong tree while the rest operates on
  `$PROJECT_ROOT` — partial, inconsistent state.
- **Remediation:** Either `cd "$PROJECT_ROOT"` once at startup (simplest; `finalize-round.sh`
  effectively assumes this), or prefix every relative path with `$PROJECT_ROOT/`.

### M6. `--wave-gate` depends on `scripts/verify-wave-aggregate.sh`, which does not exist anywhere in the repo
- **File:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:193,410,814,825-837`
- **Problem:** The wave-gate close flow's "Step 1: aggregate verifier" can never run — the script
  is not shipped (only `multi-track-verify-wave-merge.sh` exists). The fallback warning is also
  wrong twice over: "Install with: `chmod +x scripts/verify-wave-aggregate.sh`" cannot install a
  missing file, and the wave gate proceeds with only the solo-tier heuristic.
- **Remediation:** Ship the script, point the flow at `multi-track-verify-wave-merge.sh` if that
  was the intended successor, or remove the dead step and its help text.

### M7. Coordinator mode references project-specific and never-scaffolded files
- **Files:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:736-743` (prompt), `:1668` (role file), `:1821-1831` (preflight), `new-project.sh:39-44`
- **Problem:** The generic Coordinator prompt hardcodes one project's artifacts:
  `coordination/SCOPING-MEMO-v0.3.md`, `coordination/PHASE-2-SLICE-1-CLOSE-WALK.md`,
  `PHASE-2-SLICE-2-CLOSE-WALK.md` (Tessera-specific), plus `templates/README.md` — which doesn't
  exist even in this repo's `legacy/templates/`. Additionally, `--coordinator` requires
  `CLAUDE-COORDINATOR.md`, but there is no `CLAUDE-COORDINATOR.md.template`, `new-project.sh`
  never creates it, and preflight's required-file check (`run-pipeline.sh:1821-1822`) doesn't
  include it — so coordinator mode fails (or runs with a missing role context) on every scaffolded
  project. `new-project.sh` also never copies `templates/` into projects, though the prompt tells
  the model to read `templates/WAVE-PLAN-TEMPLATE.md`.
- **Remediation:** Parameterize or delete the project-specific read list; add a
  `CLAUDE-COORDINATOR.md.template` and include it in scaffold + preflight (at least when
  `--coordinator` is passed); copy or inline the wave-plan template.

### M8. Round lockfile acquisition is not atomic
- **File:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:455-503`
- **Problem:** `acquire_round_lock` does check-then-create (`[[ -f $LOCKFILE ]]` … `cat > $LOCKFILE`).
  Two pipelines launched simultaneously for the same round can both pass the check and both
  proceed — precisely the R10 double-REVIEWER race the lock was added to prevent (comment at
  `:440-443`).
- **Remediation:** Use an atomic primitive: `mkdir "$LOCKDIR"` or
  `set -o noclobber; > "$LOCKFILE"` to create-and-claim in one step.

### M9. Two diverged copies of `finalize-round.sh` in the same toolkit
- **Files:** `legacy/integrations/superpowers-claude-code/finalize-round.sh` (199 lines, env-configurable
  `ANCHOR_BINDING_COMMANDS`/`ANCHOR_SOURCE_DIRS`) vs `scripts/finalize-round.sh` (176 lines,
  hardcoded npm stack + pipeline-lock removal + `git add -u`)
- **Problem:** The copies differ materially (configurability, lock cleanup, staging scope —
  `git add -u` in the scripts/ copy stages tracked modifications *anywhere* in the tree into the
  "coordination artifacts" commit). `check-pipeline-sync.sh:31-37` only syncs the `scripts/`
  copy; `new-project.sh` copies **both** into projects. Operators can't tell which is canonical,
  and fixes (H1/H2) must land twice.
- **Remediation:** Keep one (the configurable root version + the lock-removal line), make the
  other a one-line exec shim, and add it to the sync manifest.

---

## Low

### L1. ADR-0002 says "five" disciplines; the pack now has six
- **File:** `design/adr/0002-split-deterministic-gate-from-behavioral-pack.md:43-47,51` vs `DISCIPLINES.md:27-28`, `README.md:16-17`
- **Problem:** The accepted ADR describes Anchor as "the five behavioral disciplines" / "five
  incentive-fighting disciplines". Discipline 6 (durable project trail, PR #114) was added later
  with no refining note, so the repo's foundational ADR now contradicts its flagship doc — against
  the project's own ADR discipline (supersede/refine, don't let it silently drift).
- **Remediation:** Add a short refinement note (or ADR-0003) recording the addition of
  Discipline 6, or a bracketed editorial annotation in ADR-0002's context.

### L2. ADR-0001 contains a placeholder/stale path
- **File:** `design/adr/0001-pivot-to-verification-harness.md:39-40`
- **Problem:** "see `design/.../DESIGN-context-break-benchmark.md` and
  `integrations/superpowers-claude-code/DESIGN-context-break-benchmark.md`" — the first is a
  literal `...` placeholder; both point pre-archive (the file now lives at
  `legacy/integrations/superpowers-claude-code/DESIGN-context-break-benchmark.md`). Same staleness
  applies to the `Supersedes:` line (`:6-8`) and the salvage-map script paths.
- **Remediation:** Annotate with current `legacy/`-prefixed paths (editorial bracket, since the
  ADR text itself is historical).

### L3. Broken relative link in the multi-cluster archive
- **File:** `legacy/multi-cluster-parallelism/README.md:5`
- **Problem:** Links `../../skills/12-coordinator-role.md`, which resolves outside the repo's
  `legacy/skills/`; correct target is `../skills/12-coordinator-role.md`. (Verified by a full-repo
  link check; this is the only true broken relative link — the `Q-[N]-SPEC-AUDIT.md` "links" in
  `legacy/templates/Q-NN-SPEC-TEMPLATE.md:6,159` are intentional placeholders.)
- **Remediation:** Fix the prefix.

### L4. Literal placeholder URL `https://github.com/[link]`
- **File:** `legacy/case-studies/deploysignal-coordination-trail.md:100`
- **Problem:** "please open an issue in the [anchor repo](https://github.com/[link])" — a
  never-filled template placeholder shipping in a published case study.
- **Remediation:** Point at `https://github.com/johnpatrickwarren-oss/anchor`.

### L5. `legacy/README.md` table misplaces the parallelism directory
- **File:** `legacy/README.md:31`
- **Problem:** Row lists `design/`, `design/multi-cluster-parallelism/`; the directory actually
  sits at `legacy/multi-cluster-parallelism/` (not under `design/`).
- **Remediation:** Correct the path.

### L6. Stale repo name `arch-gate` (now `sprag`)
- **File:** `legacy/design/architectural-invariant-gate.md:3`
- **Problem:** Links `github.com/johnpatrickwarren-oss/arch-gate` and recommends
  `npm i -g github:johnpatrickwarren-oss/arch-gate`. The repo was renamed — the GitHub API now
  resolves it to `johnpatrickwarren-oss/sprag` (works only via redirect; the rename can be
  shadowed by a new repo claiming the old name).
- **Remediation:** Update both references to `sprag`.

### L7. `models.json` references a non-existent `scripts/refresh-models.ts`
- **File:** `legacy/integrations/superpowers-claude-code/scripts/models.json:2`
- **Problem:** The `_comment` says to update model IDs "via scripts/refresh-models.ts"; no such
  file exists in the repo.
- **Remediation:** Remove the reference or ship the script.

### L8. `anchor-overnight.sh` safety claim is misleading
- **File:** `legacy/integrations/superpowers-claude-code/anchor-overnight.sh:11-16,50-84`
- **Problem:** The header claims the allow-list "is intentionally NOT blanket-bypass" and excludes
  `rm`/`sudo`/`curl`/`eval` — but it allows `Bash(node *)`, `Bash(npx *)`, `Bash(npm *)`,
  `Bash(git *)`, `Bash(sed *)`, `Bash(awk *)`, `Bash(find *)`, each of which reaches arbitrary
  command execution (e.g. `find -exec rm`, `npx <pkg>`, `node -e`, git aliases/hooks), making the
  exclusions cosmetic. The mechanism is fine for its purpose; the *safety framing* overpromises.
- **Remediation:** Reword the header to state honestly that the list still permits arbitrary code
  execution and is a UX convenience for trusted, dedicated project dirs only.

### L9. Memorial-Updater prompt: "Complete all five deliverables" lists six
- **File:** `legacy/integrations/superpowers-claude-code/run-pipeline.sh:1430-1485`
- **Remediation:** s/five/six/ (or renumber NEXT-ROLE.md update as a routing step).

### L10. Stale "canonical" default path after the `legacy/` move
- **Files:** `legacy/integrations/superpowers-claude-code/scripts/check-pipeline-sync.sh:22`,
  `anchor-update-project.sh:37`, `scripts/anchor-wave-init.sh:44`
- **Problem:** All default to `~/anchor/integrations/superpowers-claude-code`; with the archive
  layout the in-repo path is `~/anchor/legacy/integrations/superpowers-claude-code`. The absent-
  canonical fallbacks keep this from erroring, but the sync/drift checks silently no-op.
- **Remediation:** Update the defaults (or document that `CANONICAL_DIR`/`ANCHOR_CANONICAL` must
  be set post-archive).

### L11. No CI at all, despite shipped test suites (one failing)
- **Files:** *(absent)* `.github/workflows/`; suites at `legacy/packages/*/test/`,
  `legacy/integrations/superpowers-claude-code/tests/scripts/`, `legacy/prototypes/verification-harness/test-gate.mjs`
- **Problem:** Nothing exercises the repo's own tests or checks links on push, which is how M1–M3
  (a failing unit test, a crashing validator, a failing smoke test) shipped unnoticed. Even
  "archive-frozen" repos benefit from a docs-only link-check CI for the maintained surface.
- **Remediation:** Add a minimal workflow: markdown link check on `README.md`/`DISCIPLINES.md`/
  `design/` (+ optionally run the legacy suites with `continue-on-error` for visibility).

---

## Prioritized remediation checklist

**Maintained surface (do first — this is the product):**
- [x] L1 — Reconcile ADR-0002's "five disciplines" with the current six (refinement note or ADR-0003).
- [x] L2 — Fix ADR-0001's `design/.../` placeholder path and annotate pre-archive paths with `legacy/` equivalents.
- [x] L11 — Add a minimal CI workflow (markdown link check; optional test visibility).

**Legacy correctness (the "it still runs from here" claim):**
- [x] H1 — Add `--` (or existence-filter) to all `git diff` pathspec calls in both `finalize-round.sh` copies; stop suppressing git stderr.
- [x] H2 — Include untracked coordination files in `finalize-round.sh` step-3 change detection (drop the `grep -v "^??"` filter or add-then-check).
- [x] M9 — De-duplicate the two diverged `finalize-round.sh` copies; canonical now `scripts/finalize-round.sh` (configurable version + lock removal); root is an exec shim; both in sync manifest.
- [x] M1 — Fix `legacy/packages/core/test/citation.test.ts:73` path (`legacy/packages/core/package.json` or `git rev-parse --show-prefix`).
- [x] M2 — Fix `tier-router-validate.ts` ESM `__dirname` crash; commit or retarget `tier-router-fixtures/corpus.json`; point spawn at `tier-router.ts`.
- [x] M3 — Make `check-lint-baseline.sh` fail closed when `npm run lint` cannot run; make its smoke test self-contained.
- [x] M4 — Record a routing decision (ESCALATE/MERGE-READY) in the hybrid-Reviewer degraded path.
- [x] M5 — `cd "$PROJECT_ROOT"` at `run-pipeline.sh` startup (or absolutize the remaining relative paths).
- [x] M6 — Ship or remove `scripts/verify-wave-aggregate.sh`; fix the misleading "Install with chmod" hint. (Removed the dead step; the close flow now points the operator at the existing `multi-track-verify-wave-merge.sh`.)
- [x] M7 — Remove Tessera-specific reads from the Coordinator prompt; add `CLAUDE-COORDINATOR.md` template + scaffold + preflight coverage; ship `templates/` to scaffolded projects.
- [x] M8 — Make round-lock acquisition atomic (`mkdir` or `noclobber`).

**Hygiene / docs (batchable):**
- [x] L3 — Fix `legacy/multi-cluster-parallelism/README.md:5` link prefix.
- [x] L4 — Replace `https://github.com/[link]` placeholder in the DeploySignal case study.
- [x] L5 — Correct the `design/multi-cluster-parallelism/` path in `legacy/README.md:31`.
- [x] L6 — Update `arch-gate` → `sprag` link and npm install command.
- [x] L7 — Remove/ship `scripts/refresh-models.ts` referenced by `models.json`. (Reference removed; noted as planned-but-never-shipped.)
- [x] L8 — Reword `anchor-overnight.sh` safety claims (allow-list still permits arbitrary execution).
- [x] L9 — "five deliverables" → six in the Memorial-Updater prompt.
- [x] L10 — Update stale `~/anchor/integrations/...` canonical defaults to the `legacy/` path.

---

## Appendix — test runs (this review, commit `267d045`)

| Suite | Command | Result |
|---|---|---|
| `@anchor/core` | `node --test test/*.test.ts` (Node v25.9.0, after `pnpm install`) | **133/134 pass** — 1 fail: `citation.test.ts:69` (M1) |
| `@anchor/cli` | `node --test test/*.test.ts` | **42/42 pass** |
| `@anchor/runtime-agent-sdk` | `node --test test/*.test.ts` | **34/34 pass** |
| Shell smoke tests | `tests/scripts/*.test.sh` | **4/5 pass** — `check-lint-baseline.sh.test.sh` FAILS on fresh clone (M3) |
| Tier-router validator | `node scripts/tier-router-validate.ts` | **crash** — ESM `__dirname` + missing fixtures (M2) |
| Impl-model-select validator | `node scripts/impl-model-select-validate.ts` | **5/5 pass** |
| Verification-harness gate | `node test-gate.mjs` | **pass** (correctly rejects the saved bad oracle) |

*(`node_modules` created for the run were removed afterward; working tree left clean.)*

---

## Remediation pass — 2026-06-10 (branch `fix/remediation-2026-06-10`)

All 20 checklist items fixed; none deferred. Post-fix test sweep (Node v25.9.0, after
`pnpm install --frozen-lockfile` in `legacy/`; `node_modules` removed afterward):

| Suite | Result |
|---|---|
| `@anchor/core` | **134/134 pass** (M1 fixed) |
| `@anchor/cli` | **42/42 pass** |
| `@anchor/runtime-agent-sdk` | **34/34 pass** |
| Shell smoke tests (5) | **5/5 pass** (M3 fixed; finalize-round test extended for H1/H2) |
| Tier-router validator | **6/6 corpus cases, exit 0** (M2 fixed; corpus reconstructed) |
| Impl-model-select validator | **5/5 pass** |
| Verification-harness gate | **pass** (correctly rejects the saved bad oracle) |
| Full-repo relative-link check | **clean** (only the intentional `Q-[N]` template placeholders remain) |
