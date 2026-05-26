## Round R40 scope (Wave 1 cluster wu-p2-1) — current round

R40 ships **WU-P2.1** from `coordination/WAVE-PLAN-01.md` — the Contract
chain foundation. Two PRD FRs: **FR-CON-01 (estimate-to-contract
conversion)** and **FR-CON-02 (base contract template)**. This is the
foundation work unit feeding 8 downstream WUs (P2.2, P2.3, P2.4, P2.6,
P2.7, P3.2, P3.6, P4.3) — it MUST land cleanly because every subsequent
contract-chain round depends on it.

### Tier verdict

**Tier:** `full` (Architect + Implementer + Reviewer + Memorial-Updater).
Coordinator prior from WAVE-PLAN-01.md Step 6.

A-factors firing (any single one → full):
- **A2 new architectural pattern:** TRUE — first contract-entity flow in
  the project (estimate → contract → signed → project record). The
  conversion semantics + contract status state machine are novel here.
- **A3 unresolved OQ:** TRUE — the base contract template content
  (required clauses per AC-CON-02-1: parties, scope, price, payment
  schedule, start/end dates, change order clause, right-to-stop-work,
  warranty, lien waiver, dispute resolution, governing law) needs
  Architect-side decisions about template authoring approach
  (string-template vs JSON-schema vs DB-stored), state-specific
  language defaults (right-to-cure periods per AC-CON-02-2), and the
  governing-law selector data shape.
- **A4 novel data model:** TRUE — new Contract entity with milestone
  schedule rows, status enum (Draft / Sent / Viewed / Signed /
  Declined), reference to source estimate version, and template-
  content storage. New `Contract`, `ContractMilestone`, and possibly
  `ContractClause` Prisma models.
- **A5 critical NFR ties:** TRUE — contract data integrity is the most
  business-critical state in the system (legal record). Payment
  schedule arithmetic per AC-CON-02-3 must tolerate $1.00 rounding
  with explicit validation.
- **A6 large blast radius:** TRUE — every downstream Phase-2 round
  reads from this work unit. A foundation flaw cascades.

S-factors (would qualify for audit if A-factors were all FALSE): N/A —
A2, A3, A4, A5, A6 all fire.

**Verdict:** `full`. Architect cold-eye design pass is load-bearing.

### Scope

**In scope:**

1. **Prisma schema additions** — `Contract` model (id, firmId,
   estimateId, estimateVersion, status, contractValue, governingLaw,
   startDate, estimatedCompletionDate, warrantyDurationDays, scopeOfWork,
   createdAt, updatedAt, signedAt, signedClientName, signedIp,
   signedDocumentHash); `ContractMilestone` model (id, contractId,
   label, amount, dueDate, paidAt, sortOrder); `ContractClause` model OR
   inline JSON column for clause content (Architect decides). Migration
   added to `prisma/migrations/`.
2. **Contract creation domain function** — `createContractFromEstimate(estimateId, opts)`
   that takes an accepted estimate and produces a Draft Contract with
   pre-populated fields per AC-CON-01-1 (client name + contact, project
   address, scope of work from estimate scope summary, contract price
   from estimate grand total, estimate type).
3. **Server action wrapper** — `createContractAction` at
   `src/lib/contract-actions.ts` (new file), called from the admin
   contracts UI. Domain function gates audit emission on `result.ok`
   per the 2026-05-13 reinforcement.
4. **Pre-acceptance contract creation warning** — AC-CON-01-2 flow.
   Modal confirmation when estimate is in Draft or Sent status (not
   yet Accepted).
5. **Estimate-version reference on contract** — AC-CON-01-3. Contract
   header displays "Based on Estimate v[N]" with link to that
   estimate version.
6. **Base contract template content** — all required clauses present
   per AC-CON-02-1: parties block, project address + scope, contract
   price, payment schedule (at least one milestone entry), start +
   estimated completion date fields, change order clause, right-to-
   stop-work clause, warranty statement, lien waiver acknowledgment,
   dispute resolution clause, governing law selector.
7. **Governing law selector** — AC-CON-02-2. Dropdown sets jurisdiction;
   dispute resolution clause + state-specific language (right-to-cure
   periods) update accordingly. Architect designs the data shape (likely
   a `governingLawDefaults` map keyed by state code).
8. **Milestone sum validation** — AC-CON-02-3. Server-side check that
   sum of milestone amounts equals contract price (±$1.00 tolerance).
   Returns validation error identifying the discrepancy.
9. **Warranty duration field + clause rendering** — AC-CON-02-4. Field
   default 365 days (1 year). Clause template renders the configured
   duration verbatim.
10. **Admin UI for contract creation** — minimal: a button on the
    estimate detail page ("Create Contract") that calls the server
    action, lands on the contract draft detail page. The full edit UI
    (free-form clause editing per FR-CON-03) is OUT of scope — that's
    P2.2.

**Out of scope (downstream rounds):**

- FR-CON-03 free-form clause editing + custom-clause indicator (→ P2.2)
- FR-CON-05 secure client contract delivery + identity confirmation (→ P2.3)
- FR-CON-06 e-signature capture (→ P2.3)
- FR-CON-07 signed contract PDF (→ P2.4)
- FR-CON-08 contract status tracking lifecycle (→ P2.4)
- FR-CON-09 change orders (→ P3.6)
- FR-CON-10 payment milestone reminders (→ P4.3)
- FR-POR-01 auto project record on sign (→ P2.6 — reads `signedAt` from this WU)
- FR-NOT-02 client notifications (→ P2.7 — reads contract send events from this WU)
- Mobile contract view (→ P2.5)
- Client testimonials, portfolio analytics, exports

### Acceptance criteria

- **AC-R40-01:** Prisma schema includes new `Contract`,
  `ContractMilestone` models (and `ContractClause` if Architect chose
  that approach). Migration file present in `prisma/migrations/`. New
  models exported in `@prisma/client` after generate.
- **AC-R40-02:** `createContractFromEstimate(estimateId)` domain
  function exists and returns `{ok: true, contract}` on success;
  `{ok: false, error}` when source estimate doesn't exist or doesn't
  belong to the firm. Audit event `contract.created` emitted only on
  `result.ok === true` per the gating discipline (2026-05-13
  reinforcement).
- **AC-R40-03:** Created contract is pre-populated per AC-CON-01-1 —
  client name + contact, project address, scope summary, contract
  value (grand total of source estimate), estimate type — verified by
  an integration test that creates an accepted estimate, calls the
  action, asserts each field's value matches the source.
- **AC-R40-04:** Pre-acceptance creation flow (AC-CON-01-2) returns a
  warning state when source estimate is Draft or Sent; only proceeds
  with explicit `confirm: true` opts flag. Two integration tests
  cover: (a) warning returned without flag, no contract created; (b)
  contract created when flag is passed.
- **AC-R40-05:** Contract header includes `estimateVersion` field
  populated from the source estimate's version number at creation
  time. Verified by a test that creates a v2 estimate, accepts it,
  creates contract, asserts `contract.estimateVersion === 2`.
- **AC-R40-06:** Base contract template renders ALL required clauses
  per AC-CON-02-1 (parties, project address + scope, price, payment
  schedule, start + end dates, change order clause, right-to-stop-work,
  warranty, lien waiver, dispute resolution, governing law). Verified
  by an integration test that creates a contract and asserts each
  clause type is present in the rendered output via
  `expect(html).toContain(...)` for distinctive clause text.
- **AC-R40-07:** Governing-law selector (AC-CON-02-2) — selecting a
  state updates the dispute resolution clause text. Verified by a
  test that asserts at least two distinct states produce distinct
  rendered clause text (e.g., CA vs TX right-to-cure language).
- **AC-R40-08:** Milestone sum validation (AC-CON-02-3) — sum of
  milestone amounts must equal contract price within ±$1.00. Three
  tests: (a) valid sum passes; (b) off by $0.50 passes; (c) off by
  $2.00 fails with validation error identifying the discrepancy.
- **AC-R40-09:** Warranty duration field (AC-CON-02-4) defaults to
  365 days; rendered clause text contains the configured duration.
  Test asserts duration appears verbatim in the clause.
- **AC-R40-10:** All 5 binding commands exit 0 at HEAD (typecheck,
  lint, test, test:integration, test:e2e). Lint warning count is at
  or below baseline (3 warnings).
- **AC-R40-11:** SHA-A attestation invariant per R15 reinforcement —
  `git diff <SHA-A> HEAD -- src/ tests/ prisma/` returns empty after
  `finalize-round.sh` runs.

### Anti-scope

- No work on FR-CON-03 through FR-CON-10 (those are downstream rounds).
- No client-facing contract surfaces (delivery, signing, viewing) —
  those are P2.3 / P2.5.
- No PDF generation — that's P2.4.
- No QuickBooks integration — P4.4.
- No automatic project record creation on signing — P2.6 (this WU
  doesn't sign contracts; it only creates them in Draft state).
- No change order schema or flows — P3.6.

### Reinforcements in scope (call-outs of particular relevance)

- **2026-05-10 next.config.ts empirical verification.** If Architect
  selects an approach that requires a new npm dependency with native
  bindings (e.g., a contract-template engine), empirically verify
  `next build` works before claiming "no next.config.ts change needed."
- **2026-05-12 SHA-A attestation two-commit pattern.** Operator-level
  discipline; `finalize-round.sh` mechanizes it. Reviewer verifies
  the `git diff SHA-A HEAD -- src/ tests/ prisma/` invariant.
- **2026-05-13 spec self-flag discipline.** Any inline `verify this`
  / `double-check` / `TBD` marker in the spec MUST be resolved before
  routing. The base-template content has many unknowns that will
  surface as self-flags during Architect drafting — resolve each.
- **2026-05-13 multi-clause AC sub-requirement discipline.** AC-R40-06
  (all required clauses) has 11 sub-requirements (one per clause type).
  Spec pseudocode + implementation tests must contain a distinct
  assertion for EACH clause type, not just "the clause set is non-empty."
- **2026-05-13 audit-emit failure-path gating.** All new server actions
  must gate audit emission on `result.ok === true`. Apply universally
  to every action introduced in this round.
- **2026-05-14 schema-cascade backward-compat verification.** Adding
  three new Prisma models is a substantial schema change. Before
  drafting the §3.5 backward-compat section, empirically run
  `npm run test:integration` against the draft migration to detect
  any unforeseen interaction with existing test fixtures.

### Cluster context (Wave 1 cross-cluster awareness)

This cluster is one of 4 in Wave 1 per `coordination/WAVE-PLAN-01.md`.
The other three clusters (P1.1 — project completion + visibility; P1.2 —
photo upload; P1.5 — manual price list) are independent of this WU and
will run in parallel worktrees. **No CLUSTER-HANDOFF artifacts are
needed for Wave 1** — per the dry-run DAG analysis, the 4 work units
have zero inter-cluster dependency edges.

Migration generation in parallel worktrees: this cluster adds the
Contract / ContractMilestone tables; the other clusters add
disjoint schema (Project fields, Photo table, PriceListItem table).
Timestamp prefixes are assigned at `prisma migrate dev --create-only`
invocation time per worktree — distinct wall-clock seconds means
distinct prefixes means clean merge. If somehow two clusters generate
identical timestamps (unlikely), the wave-merge step renames one with
a +1 second prefix.
