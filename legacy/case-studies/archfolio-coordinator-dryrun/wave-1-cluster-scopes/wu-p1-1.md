## Round R41 scope (Wave 1 cluster wu-p1-1) — current round

R41 ships **WU-P1.1** from `coordination/WAVE-PLAN-01.md`. Two PRD FRs:
**FR-POR-02 (project completion entry)** and **FR-POR-04 (portfolio
entry visibility control)**. Phase-1 island — no dependencies into or
out of this WU within Wave 1's scope. Extends the existing Project
entity with completion-state fields and a visibility setting.

### Tier verdict

**Tier:** `audit` (Implementer + Reviewer + Memorial-Updater).
Coordinator prior from WAVE-PLAN-01.md Step 6.

A-factors: all FALSE.
- A2: extends the existing Project entity / admin pattern; not a new pattern.
- A4: incremental fields on existing model; not a novel data model.
- A6: blast radius is bounded to the Project + portfolio surfaces.

S-factors firing (audit acceptable):
- **S1 extends existing portfolio pattern.** TRUE — Project status,
  admin edit flows, and portfolio public surfaces already exist in
  prior rounds. This round adds completion state + visibility on top.

Z-factors: not all single-file / test-only / cosmetic. Multi-file
work touching Project schema + admin UI + public portfolio rendering
pushes above the Z threshold.

**Verdict:** `audit`. Implementer authors a thin spec, executes,
Reviewer audits cold.

### Scope

**In scope:**

1. **Project schema fields** — add `completedAt: DateTime?`,
   `actualCompletionDate: DateTime?`, `finalContractValue: Decimal?`,
   `originalContractValue: Decimal?`, and `visibility: ProjectVisibility`
   enum (`PUBLIC` / `PRIVATE` / `UNLISTED`, default `PRIVATE`). Migration
   in `prisma/migrations/`.
2. **`markProjectCompletedAction` server action** — admin server action
   that marks a project Completed with operator-supplied actual
   completion date + final contract value. Per AC-POR-02-1, status
   changes Active → Completed; dashboard placement updates.
3. **Final contract value vs original value handling** — AC-POR-02-3.
   When `finalContractValue` differs from `originalContractValue`,
   both are preserved in the record. Portfolio displays the final
   (or a range, per builder display setting — config is OUT of scope;
   default to displaying final).
4. **Project completion tags** — AC-POR-02-2. Builder can add tags
   to a completed project. Tag storage: a simple string-array column
   on Project (or a separate ProjectTag table — Implementer chooses
   based on existing project conventions; the simpler is acceptable
   here since tag filtering / FR-POR-07 is downstream P3.x).
5. **`setProjectVisibilityAction` server action** — toggles project
   `visibility` between PUBLIC / PRIVATE / UNLISTED. Per
   AC-POR-04-1/2/3, controls public portfolio grid + direct-link
   behavior.
6. **Public portfolio grid filter** — public route at
   `/[firmname]` (assumed already routed by FR-ACC-05 / R39) filters
   `Project.visibility === PUBLIC` only. UNLISTED projects do not
   appear in the grid but ARE reachable via direct link.
7. **Visibility transition handling** — AC-POR-04-4. When visibility
   changes Public → Private, the project disappears from the grid
   immediately (60s reload-tolerance is a no-op; we're not caching).
   Direct-link URLs to a now-Private project return a "no longer
   publicly available" page.

**Out of scope (downstream rounds):**

- Photo upload (→ P1.2 — separate cluster in this same wave)
- Public portfolio grid composition + hero photo + truncated description
  (FR-POR-05 — partially landed in prior rounds; layout polish not in
  this round)
- Per-project shareable link with photo gallery (FR-POR-06 → P2.x or
  later if not already landed)
- Filtered portfolio links (FR-POR-07 → P3.x)
- Client testimonials (FR-POR-08 → P3.x)
- Portfolio analytics (FR-POR-09 → P4.x)
- Builder display-setting for value-range vs final-value (covered by
  AC-POR-02-3 in PRD but deferred — default to final value)

### Acceptance criteria

- **AC-R41-01:** Prisma schema has new `completedAt`,
  `actualCompletionDate`, `finalContractValue`, `originalContractValue`,
  and `visibility` (ProjectVisibility enum) fields on Project. Migration
  applied successfully; `npm run test:integration` exit 0 against the
  new schema.
- **AC-R41-02:** `markProjectCompletedAction(projectId, opts)` exists
  and: (a) updates `status` Active → Completed; (b) sets
  `completedAt`, `actualCompletionDate`, `finalContractValue`;
  (c) returns `{ok: true, project}` on success, `{ok: false, error}`
  when project is not Active, not owned by firm, or doesn't exist;
  (d) emits `project.completed` audit event ONLY on `result.ok ===
  true`.
- **AC-R41-03:** When builder enters a different `finalContractValue`
  from the original, the project record stores BOTH values
  (`originalContractValue` set at completion time from the contract
  signing value if not already populated; `finalContractValue` from
  the operator). Verified by an integration test with literal Decimal
  values like `125000.50` (use `.equals(new Prisma.Decimal("125000.50"))`
  per the 2026-05-13 Decimal-trailing-zero reinforcement).
- **AC-R41-04:** `setProjectVisibilityAction(projectId, visibility)`
  exists; updates visibility; returns `{ok: true}` / `{ok: false}` with
  audit gating on `result.ok`.
- **AC-R41-05:** Public portfolio grid at `/[firmname]` filters to
  `Project.visibility === 'PUBLIC'`. Integration test creates two
  projects (PUBLIC + PRIVATE) under one firm; asserts the rendered
  grid contains the PUBLIC project's name and does NOT contain the
  PRIVATE project's name.
- **AC-R41-06:** UNLISTED projects are reachable via direct link but
  not via grid. Test: visiting `/[firmname]/project/[id]` for an
  UNLISTED project returns 200 + project detail; visiting
  `/[firmname]` does NOT include the UNLISTED project in the grid.
- **AC-R41-07:** Transition from PUBLIC → PRIVATE makes the project's
  direct-link URL return a "no longer publicly available" page (HTTP
  200 + body contains that string). Test asserts via actual HTTP
  request per the 2026-05-10 response-path-coverage reinforcement.
- **AC-R41-08:** All 5 binding commands exit 0 at HEAD. Lint at or
  below baseline.
- **AC-R41-09:** SHA-A attestation invariant: `git diff <SHA-A> HEAD
  -- src/ tests/ prisma/` empty after `finalize-round.sh`.

### Anti-scope

- No photo upload — that's the parallel WU-P1.2 cluster in this same
  wave.
- No contract-completion flow integration — Project status is set by
  THIS round's action, not by P2.6's auto-create-on-sign flow (which
  happens in Wave 5).
- No portfolio public surface restructuring — visibility is the only
  new filter; existing layout is unchanged.
- No value-range vs final-value builder display setting — defer to
  builder-display-config follow-up.
- No filtered links (FR-POR-07), no testimonials (FR-POR-08), no
  analytics (FR-POR-09).

### Reinforcements in scope (call-outs)

- **2026-05-13 Decimal trailing-zero discipline.** Use
  `result.equals(new Prisma.Decimal("125000.50"))` for any AC asserting
  a literal Decimal value with trailing zeros — `.toString()` strips
  them.
- **2026-05-13 audit-emit failure-path gating.** Both new server actions
  must gate on `result.ok === true`.
- **2026-05-14 schema-cascade backward-compat verification.** Adding
  enum + nullable fields to Project — empirically run
  `npm run test:integration` before drafting §3.5 backward-compat
  section. Existing tests reference Project model heavily; verify mock
  shapes still compile.

### Cluster context (Wave 1)

Parallel with WU-P2.1 (Contract foundation), WU-P1.2 (Photo upload),
WU-P1.5 (Manual price list). Zero inter-cluster dependency edges per
WAVE-PLAN-01.md Step 2. Migration is disjoint — this WU touches Project
schema; P2.1 adds Contract tables; P1.2 adds Photo; P1.5 adds
PriceListItem. Distinct schema surfaces means D5-contention (lock at
generation time), not D5-strict (serial dependency). Per the
two-layer arbitration design in skills/12 §Schema migrations.
