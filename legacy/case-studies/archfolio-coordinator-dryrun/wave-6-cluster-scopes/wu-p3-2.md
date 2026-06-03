## Round R54 scope (Wave 6a cluster wu-p3-2) — current round

R54 ships **WU-P3.2** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-INT-02 (signed contract PDF export with change-order addenda)**.
Audit tier. Extends R48's signed contract PDF.

### Tier verdict

**Tier:** `audit`. Extends R48 contract PDF infra. Change orders
themselves come in WU-P3.6 (parallel cluster, this same wave) —
but P3.2 is forward-compatible (handles 0 change orders cleanly;
when P3.6 lands change orders, the bundling logic activates).

### Scope

**In scope:**

1. **`exportSignedContractPackage(contractId)`** — generates a
   single PDF containing:
   - The original signed contract (from R48's `signedPdfPath`)
   - Each signed change order in chronological order (zero in R54
     since change orders land in R57/WU-P3.6)
   - A summary page: original contract value, each change order
     delta, final contract total
   Per AC-INT-02-1.
2. **Hash verification at footer** — display the SHA-256 hash
   stored at signing time per AC-INT-02-2. For the bundled package
   (multi-doc), display each component's hash + a new aggregate
   hash for the bundle.
3. **Admin UI** — "Download Final Contract Package" button on
   contract detail page (visible only when contract.status ===
   'Signed').

### Acceptance criteria

- **AC-R54-01:** `exportSignedContractPackage(contractId)` returns
  PDF buffer. Test for Signed contract with 0 change orders: assert
  output contains original signed contract content + summary page.
- **AC-R54-02:** Hash matches `contract.signedDocumentHash` from
  R48. Test computes SHA-256 of the original-contract section of
  the bundled PDF; asserts equal to stored hash.
- **AC-R54-03:** Refuses on non-Signed contract. Test: Draft / Sent
  / Declined contracts return `{ok: false}` with error mentioning
  status.
- **AC-R54-04:** Summary page renders correctly. Test: assert the
  bundled PDF text contains "Original Contract: $XXX" + total
  (verbatim literal per AC-literal-pass).
- **AC-R54-05:** All 5 binding commands. test:e2e actually run.
- **AC-R54-06:** SHA-A invariant.

### Anti-scope

- No change-order schema (WU-P3.6).
- No payment milestone integration (WU-P4.3).
- No re-signing flow if hash mismatch detected.

### Reinforcements

- **AC-literal-pass:** summary page text + filename pattern.
- **Anti-self-confirming:** PDF binary assertions read actual
  output bytes, not setup.

### Cluster context (Wave 6a)

Parallel with wu-p3-1, wu-p3-3, wu-p3-4, wu-p3-6. Disjoint scope:
this cluster touches `src/lib/pdf/contract.ts` + contract detail
page. R48's signed PDF infrastructure already on main.
