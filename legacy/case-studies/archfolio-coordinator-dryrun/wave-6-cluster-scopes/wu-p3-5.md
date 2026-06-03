## Round R58 scope (Wave 6b cluster wu-p3-5) — current round

R58 ships **WU-P3.5** from `WAVE-PLAN-01.md`. Two PRD FRs:
**FR-SUP-05 (price discrepancy flagging)** + **FR-SUP-07 (price
snapshot at finalization)**. Audit tier. Depends on R56 catalog API.

### Tier verdict

**Tier:** `audit`. Builds on R56 (catalog API) + R43 (manual price
list). No new external deps.

### Scope

**In scope:**

1. **Price discrepancy detection** — per AC-SUP-05-1: when line
   item has both manual/cached AND live supplier price, and they
   differ by >10%, display both side-by-side + amber visual flag +
   prompt builder to select.
2. **Send-blocking on unresolved flags** — per AC-SUP-05-2: cannot
   send quote with active flags. Modal lists unresolved with
   Review shortcuts.
3. **Silent application within tolerance** — per AC-SUP-05-3: ≤10%
   diff, no flag, live price applied silently.
4. **Price snapshot at send** — per AC-SUP-07-1: when quote status
   changes to Sent, freeze line-item prices as snapshot. Subsequent
   live or manual changes don't alter the finalized quote.
5. **Snapshot viewing** — per AC-SUP-07-2: quote history shows
   snapshot date + locked values alongside current differences.

### Acceptance criteria

- **AC-R58-01:** Discrepancy detection: test with 11% diff fires
  flag; 9% diff doesn't.
- **AC-R58-02:** Send-blocking: attempt to send quote with active
  flag returns `{ok: false}` listing flagged items.
- **AC-R58-03:** Send succeeds after all flags resolved.
- **AC-R58-04:** Snapshot stored on send. Test: send quote;
  then mutate live price; assert quote.lineItems show frozen
  prices on history view.
- **AC-R58-05:** Snapshot history view shows diff. Test asserts
  current price vs snapshot rendered side-by-side.
- **AC-R58-06:** All 5 binding commands. test:e2e actually run.
- **AC-R58-07:** SHA-A invariant.

### Anti-scope

- Live alerts to active quotes (WU-P4.1).
- Multi-supplier comparison.

### Reinforcements

- **AC-literal-pass:** 10% threshold, amber-flag CSS class.
- **Anti-self-confirming:** snapshot immutability mutate-checked
  (would test pass if snapshot were never frozen?).
- **§2.x manifest:** snapshot table + flag UI + send-action change.

### Cluster context (Wave 6b)

Parallel with wu-p3-7, wu-p4-1, wu-p4-2, wu-p4-3. Depends on R56
(supplier catalog API) which lands in Wave 6a — R58 dispatches
only AFTER Wave 6a merges cleanly.
