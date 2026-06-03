## Round R57 scope (Wave 6a cluster wu-p3-6) — current round

R57 ships **WU-P3.6** from `WAVE-PLAN-01.md`. Two PRD FRs:
**FR-CON-09 (change orders)** + **FR-CON-04 (custom clause library)**.
Audit tier. Extends R40 Contract entity + R45 clause editing.

### Tier verdict

**Tier:** `audit`. Schema additions are bounded (ChangeOrder table
+ ClauseLibrary table). Patterns from R40 + R45 + R46.

### Scope

**In scope:**

1. **ChangeOrder schema** — id, contractId (FK), description, costDelta
   (Decimal), revisedCompletionDate, draftedAt, sentAt, signedAt,
   declinedAt, declineReason, signedSignature, signedIp.
2. **`createChangeOrderAction`** — per AC-CON-09-1: creates change
   order as draft with description, cost delta, revised completion
   date. Preview available before sending.
3. **`sendChangeOrderAction`** — sends via secure link (reuse R46
   ContractLink pattern with `kind: CHANGE_ORDER` discriminator
   OR new ChangeOrderLink table; Implementer chooses).
4. **Client-facing change order view + signing** — per AC-CON-09-2:
   client sees original contract total, change order delta+desc,
   new contract total, Sign/Decline action.
5. **`signChangeOrderAction`** — per AC-CON-09-3: on sign, append
   to project record, update running contract total, regenerate
   signed PDF including all change orders to date (reuse R48 PDF
   infra + R54's package PDF).
6. **Timeline view** — per AC-CON-09-4: contract detail page shows
   original contract + each signed change order + running total.
7. **ClauseLibrary schema** — id, firmId, label, clauseText.
8. **`saveClauseToLibraryAction`** + **`insertFromLibraryAction`** —
   per FR-CON-04 ACs.

### Acceptance criteria

- **AC-R57-01:** ChangeOrder + ClauseLibrary schemas migrated.
- **AC-R57-02:** Create change order: integration test creates
  contract, then change order; assert ChangeOrder row exists with
  costDelta, revisedCompletionDate, draftedAt.
- **AC-R57-03:** Send change order to client; client signs; running
  contract total updates correctly. Test asserts
  `originalContractValue + sum(signedChangeOrders.costDelta) === currentTotal`.
- **AC-R57-04:** Multi-change-order timeline view renders correctly.
- **AC-R57-05:** Save clause to library + insert: clause text
  persists; insertion marks section Customized (reuses R45 logic).
- **AC-R57-06:** Bundled PDF (regenerated after change order sign)
  contains original + all change orders + summary. Reuses R54
  package PDF.
- **AC-R57-07:** Audit events `change_order.created`, `change_order.sent`,
  `change_order.signed`, `change_order.declined`, `clause.saved`,
  `clause.inserted` all emit gated on `result.ok`.
- **AC-R57-08:** All 5 binding commands. test:e2e actually run.
- **AC-R57-09:** SHA-A invariant.

### Anti-scope

- No payment-milestone changes (WU-P4.3).
- No PDF design polish.
- No client-side change-order rejection negotiation flow.

### Reinforcements

- **Anti-self-confirming:** running-total assertions must
  mutate-check.
- **§2.x manifest:** new schemas + actions + UI; inventory all.
- **HALT:** if change-order PDF regeneration requires architectural
  changes to R48's signed-PDF infrastructure, ESCALATE.

### Cluster context (Wave 6a)

Parallel with wu-p3-1, wu-p3-2, wu-p3-3, wu-p3-4. Disjoint scope:
this cluster touches `src/lib/contracts/change-orders.ts` (new) +
`src/lib/contracts/clause-library.ts` (new) + contract detail page +
new client route for change orders.
