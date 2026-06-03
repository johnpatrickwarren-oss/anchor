## Round R43 scope (Wave 1 cluster wu-p1-5) — current round

R43 ships **WU-P1.5** from `coordination/WAVE-PLAN-01.md`. One PRD FR:
**FR-SUP-02 (manual material price list with last-updated dates)**.
Phase-1 island feeding one downstream WU (P3.3 — CSV import for material
prices). Adds a new admin-managed price-list entity that feeds into
existing line-item entry flows from FR-EST-02.

### Tier verdict

**Tier:** `audit` (Implementer + Reviewer + Memorial-Updater).
Coordinator prior from WAVE-PLAN-01.md Step 6.

A-factors: all FALSE.
- A2: new entity, but the pattern (firm-scoped admin-managed CRUD) is
  well-established in the codebase via Supplier (FR-SUP-01) and prior
  admin entities.
- A4: incremental addition, not novel.

S-factors firing (audit acceptable):
- **S1 new entity following admin patterns.** TRUE — extends the
  established firm-scoped CRUD pattern.

**Verdict:** `audit`.

### Scope

**In scope:**

1. **PriceListItem Prisma model:**
   - id, firmId (FK → Firm.id, indexed for firm-scope filters),
   - description, unit, unitPrice (Decimal),
   - lastUpdatedAt: DateTime (auto-set on price change, NOT on every
     row save),
   - createdAt, updatedAt.
   - Unique constraint: (firmId, description) — prevent duplicate
     descriptions within a firm.
2. **Server actions for CRUD:**
   - `createPriceListItemAction(input)` — creates a new item.
   - `updatePriceListItemAction(itemId, input)` — updates description /
     unit / unit price. **Critical:** updates `lastUpdatedAt` ONLY when
     `unitPrice` changed (not on description-only edits) — per
     AC-SUP-02-2.
   - `deletePriceListItemAction(itemId)` — soft or hard delete.
     Implementer chooses; hard delete is fine if no audit-history
     requirement.
3. **Price-source labeling on line items** — extends line item entry
   per AC-EST-02-3 / AC-SUP-02-1. When builder selects a price from the
   manual price list during line item entry, the resulting line item
   records `priceSourceType = "MANUAL_LIST"` and the source item ID.
   This requires either a new column on LineItem (`priceSourceItemId`)
   or a separate audit-trail mechanism — Implementer chooses.
4. **90-day stale-price warning** — per AC-SUP-02-3. When builder
   selects a price-list item whose `lastUpdatedAt` is >90 days old,
   the line item entry UI displays a visible warning ("Price last
   updated [date] — verify before finalizing") adjacent to the line
   item total.
5. **Admin UI for price list:**
   - List view: shows all items with description, unit, unit price,
     last-updated date. Sorted by description ASC.
   - Add / Edit forms.
   - Delete with confirmation.
6. **Line item entry surface integration** — the existing line-item
   picker gains a "Price list" tab/section that lists firm's price-list
   items and selecting one populates the line item's price + unit
   fields with `priceSourceType = MANUAL_LIST`.

**Out of scope (downstream rounds):**

- CSV import of price list items (→ P3.3 / FR-INT-05 — reads this WU's
  model).
- Live supplier catalog integration (→ P3.4 / FR-SUP-03 — separate
  data path).
- Price discrepancy flagging (live vs cached comparison) (→ P3.5 /
  FR-SUP-05 — needs catalog API first).
- Price change alerts on active quotes (→ P4.1 / FR-SUP-06).
- Price snapshot at finalization (→ P3.5 / FR-SUP-07 — quote-level
  freeze of the price-source values).

### Acceptance criteria

- **AC-R43-01:** Prisma schema has new `PriceListItem` model with the
  specified fields and the (firmId, description) unique constraint.
  Migration applied; `npm run test:integration` exit 0.
- **AC-R43-02:** `createPriceListItemAction` creates the row; returns
  `{ok: true, item}` on success; `{ok: false, error}` on duplicate
  description within firm, missing required fields, or non-numeric
  unitPrice. Audit emission gated on `result.ok`. Test asserts both
  paths.
- **AC-R43-03:** `updatePriceListItemAction` updates `lastUpdatedAt`
  **only when unitPrice changes**. Two tests: (a) update description
  only — `lastUpdatedAt` unchanged; (b) update unitPrice — new
  `lastUpdatedAt` is later than original.
- **AC-R43-04:** 90-day stale-price warning. Integration test:
  create a price-list item; backdate its `lastUpdatedAt` to >90 days
  ago (e.g., 95 days back); add a line item using that price-source;
  assert the rendered line item shows the warning text containing
  "Price last updated" + the formatted date.
- **AC-R43-05:** Line item with price from manual list records
  `priceSourceType = "MANUAL_LIST"` + source item reference. Test
  asserts these fields are persisted.
- **AC-R43-06:** Delete action removes the row. Test asserts no rows
  remain with that id after `deletePriceListItemAction`. Audit gate
  on `result.ok`.
- **AC-R43-07:** Unique-constraint enforcement. Test creates an item;
  attempts to create a second with the same description in the same
  firm; second returns `{ok: false}` with error mentioning the
  conflict. Same description in a different firm IS allowed (test
  confirms cross-firm independence).
- **AC-R43-08:** All 5 binding commands exit 0 at HEAD. Lint at or
  below baseline.
- **AC-R43-09:** SHA-A attestation invariant: `git diff <SHA-A> HEAD
  -- src/ tests/ prisma/` empty.

### Anti-scope

- No CSV import (that's P3.3).
- No live catalog (P3.4).
- No discrepancy flagging (P3.5).
- No snapshot freezing (P3.5).
- No price-change alerts (P4.1).
- No bulk-edit UI (item-by-item edit only).
- No price-history audit log beyond what `lastUpdatedAt` records (a
  full audit trail per item could be a follow-up).

### Reinforcements in scope (call-outs)

- **2026-05-13 Decimal trailing-zero discipline.** AC-R43-04's
  warning-display test asserts a formatted date, but if any AC
  asserts a literal Decimal value (e.g., `unitPrice === 12.50`),
  use `.equals(new Prisma.Decimal("12.50"))` — `.toString()` strips
  trailing zeros.
- **2026-05-13 audit-emit failure-path gating.** All three new server
  actions gate on `result.ok === true`.
- **2026-05-14 schema-cascade backward-compat verification.** New
  PriceListItem table is disjoint from existing tables, but the line
  item table may need a new column (`priceSourceItemId`) if
  Implementer picks that approach. If so, run
  `npm run test:integration` against the draft migration to verify
  existing line-item tests don't break.

### Cluster context (Wave 1)

Parallel with WU-P2.1, WU-P1.1, WU-P1.2. Zero inter-cluster
dependency edges. Migration disjoint from the other clusters
(PriceListItem is new; others touch Contract, Project fields, Photo —
none touch PriceListItem). D5-contention path applies.

Downstream of this WU: P3.3 (CSV import for material prices) reads
the PriceListItem model. That's a Wave 6 work unit, lands much later.
