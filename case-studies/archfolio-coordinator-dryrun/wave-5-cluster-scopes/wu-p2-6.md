## Round R50 scope (Wave 5 cluster wu-p2-6) — current round

R50 ships **WU-P2.6** from `coordination/WAVE-PLAN-01.md`. One PRD FR:
**FR-POR-01 (automatic project record creation on contract sign)**.
Audit tier. Reads R46+R48's contract signing path; writes new
Project records.

### Tier verdict

**Tier:** `audit`. A-factors all FALSE. S1 + S4 fire (extends
contract sign chain; tactical follow-up). Project schema already
exists from R41.

### Scope

**In scope:**

1. **`createProjectFromContractSign(contractId, opts)` domain
   function** — invoked by R46's `signContractAction` post-status-
   change. Reads Contract + parent Estimate; produces a new
   Project record with:
   - `name`: estimate's project name (or contract scope summary
     if missing)
   - `type`: `OTHER` by default (operator can refine later;
     the PRD AC says "project type" but doesn't constrain
     derivation)
   - `firmId`: contract.firmId
   - `streetAddress`, `city`, `stateRegion`, `postalCode`: from
     estimate.projectAddressLine1/projectCity/etc.
   - `contractValue`: contract.contractValue
   - `description`: "Client — [City, State]" anonymized client
     display name (per AC-POR-01-1 default)
   - `visibility`: PRIVATE (per R41 default)
   - `completedAt`: null (Active)
2. **Wire into sign action** — extend R46's `signContractAction`
   to call `createProjectFromContractSign` AFTER successful
   sign + status-change + PDF generation. Audit emission
   `project.created_from_contract` gated on `result.ok`.
3. **Idempotency** — if a project already exists for this contract
   (e.g., re-signing somehow possible), do not create a duplicate.
   Implementer adds a Contract → Project FK (`Project.contractId
   String? @unique`) to enforce 1:1.

**Out of scope:**
- Builder UI for editing the auto-created project (existing
  admin/projects flows already cover edit).
- Project completion fields (R41 already shipped).
- Photo upload (R42).

### Acceptance criteria

- **AC-R50-01:** Schema has `Project.contractId String? @unique`
  FK to Contract. Migration applied; integration tests pass.
- **AC-R50-02:** `createProjectFromContractSign(contractId)`
  exists; returns `{ok: true, project}` on success; `{ok: false,
  error}` when project already exists for that contract OR
  contract not found OR contract.estimateId not resolvable.
  Audit event `project.created_from_contract` emitted only on
  result.ok.
- **AC-R50-03:** Signing a contract creates a Project record
  with all fields populated per AC-POR-01-1. Integration test:
  create accepted estimate → contract → sign; assert Project
  exists with matching firmId, address fields, contractValue,
  description anonymized, visibility PRIVATE, completedAt null.
- **AC-R50-04:** Anonymized client display: integration test
  asserts project.description matches pattern "Client — <City>,
  <State>" exactly (per AC-literal-pass umbrella).
- **AC-R50-05:** Idempotency: signing the same contract twice
  (if somehow possible) produces only one Project. Test: create
  Project via the action; call again with same contractId;
  assert second call returns `{ok: false}` with error mentioning
  duplicate; assert only one Project row exists for that
  contractId.
- **AC-R50-06:** R46's `signContractAction` now also calls the
  project-create. Integration test for full sign flow: assert
  Project created alongside Contract status change + PDF
  generation (R48 work also preserved).
- **AC-R50-07:** All 5 binding commands exit 0 at HEAD. Lint ≤
  baseline. **Actually run test:e2e per R47 reinforcement.**
- **AC-R50-08:** SHA-A attestation invariant.

### Anti-scope

- No project-detail UI changes beyond surfacing the new project.
- No photo upload integration.
- No portfolio public-page render changes.
- No contract → multiple-projects logic (1:1 only).

### Reinforcements in scope (call-outs)

- **§2.x manifest umbrella.** New schema migration + new domain
  function + extended sign action; all in inventory.
- **Audit-emit failure-path gating.** Critical — sign should
  succeed even if project-create fails? Or atomic transaction?
  Implementer decides; documents in spec §3.x. If transaction,
  failure rolls back the sign (operator-friction); if best-effort,
  may strand an orphan signed contract. Recommend transaction.
- **Anti-self-confirming-test (skills/13).** AC-R50-05 idempotency
  test must mutate-check — if idempotency code were removed,
  would the test still pass?

### Cluster context (Wave 5)

Parallel with wu-p2-5 (mobile contract view), wu-p2-7 (notifications),
wu-p2-8 (client polish). Disjoint file scopes: this cluster touches
`src/lib/admin/projects.ts`, `src/lib/admin/contracts.ts` (sign
extension), `src/app/contract/[token]/actions.ts`, `prisma/schema.prisma`
(new FK).

R46 + R48 changes that this cluster reads from are on main.
