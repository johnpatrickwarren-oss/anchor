## Round R60 scope (Wave 6b cluster wu-p4-1) — current round

R60 ships **WU-P4.1** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-SUP-06 (price change alerts on active quotes)**. Audit tier.
Depends on R56 catalog API + R58 price snapshot.

### Tier verdict

**Tier:** `audit`. S1 (extends supplier-pricing chain).

### Scope

**In scope:**

1. **Price change detection** — per AC-SUP-06-1: for Sent (not
   Accepted) quotes containing line items with live supplier
   pricing, when supplier price for any item changes by >threshold
   (default 5%) since quote was last saved, fire builder alert.
2. **Builder email** — identifies affected items + magnitude of
   change + link to quote for review.
3. **Configurable threshold** — per AC-SUP-06-2: builder can set
   custom threshold (e.g., 15%); no alert if change < threshold.
4. **Implementation approach** — likely a server action
   `checkActiveQuotePriceChanges()` invoked manually or via cron
   (similar to R48's `sendOverdueContractReminders`). Implementer
   chooses; document choice.
5. **Idempotency** — track `lastAlertedAt` per quote to avoid
   re-firing for same change.

### Acceptance criteria

- **AC-R60-01:** Detection: test with mocked supplier price +6%
  fires alert (default 5% threshold); +4% doesn't.
- **AC-R60-02:** Custom threshold respected. Test sets firm
  threshold to 15%; +10% change doesn't fire.
- **AC-R60-03:** Email content: subject identifies quote; body
  lists affected items + magnitude + link.
- **AC-R60-04:** Idempotency. Test: run check twice on same
  change; assert only one email sent.
- **AC-R60-05:** Only active (Sent, not Accepted/Declined/Expired)
  quotes scanned. Test asserts exclusion of inactive states.
- **AC-R60-06:** Audit event `quote.price_alert_sent` emitted on
  successful alert; failure-path-gated.
- **AC-R60-07:** All 5 binding commands. test:e2e actually run.
- **AC-R60-08:** SHA-A invariant.

### Anti-scope

- No automatic quote regeneration.
- No client-side alert (builder only).
- No multi-supplier threshold variance.

### Reinforcements

- **Anti-self-confirming:** idempotency test mutate-checked
  (would test pass if dedup were removed?).
- **AC-literal-pass:** threshold literals + email subject pattern.

### Cluster context (Wave 6b)

Parallel with wu-p3-5, wu-p3-7, wu-p4-2, wu-p4-3. Depends on
R56 (catalog API) + R58 (price snapshot) — both must land in
Wave 6a + 6b respectively. Actually R58 lands in same wave (6b)
— Implementer reads R58's snapshot fields. Acceptable since
intra-wave clusters share main; wave-gate validates afterwards.
