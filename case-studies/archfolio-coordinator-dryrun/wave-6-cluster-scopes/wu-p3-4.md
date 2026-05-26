## Round R56 scope (Wave 6a cluster wu-p3-4) — current round

R56 ships **WU-P3.4** from `WAVE-PLAN-01.md`. Two PRD FRs:
**FR-SUP-03 (live supplier catalog integration)** + **FR-SUP-04
(CSV supplier import)**. **FULL TIER**. New external API dependency
(supplier catalog).

### Tier verdict

**Tier:** `full` (Architect + Implementer + Reviewer + Memorial).
A1 fires: new external dependency. Architect must enumerate API
options (Home Depot Pro / Lowe's Pro / other) and either commit
to one or document the architectural choice + escalate for operator
auth/credentials.

### Scope

**In scope (Architect to refine):**

1. **Live supplier API integration** — per AC-SUP-03-1: connect to
   at least one national supplier (Home Depot Pro, Lowe's Pro, or
   similar); search by keyword or SKU; return current price + unit
   + availability scoped to project zip.
2. **API failure fallback** — per AC-SUP-03-2: on API timeout/error,
   fall back to manual/cached price; display warning "Live pricing
   unavailable — using last cached price from [date]"; do not block
   estimate progress.
3. **No-results UX** — per AC-SUP-03-3: SKU-not-found shows clear
   message + allows manual price entry.
4. **CSV supplier import** — per AC-SUP-04 (parallel discipline to
   WU-P3.3 / FR-INT-05 but specific to supplier catalogs vs manual
   price list). Required columns: SKU, description, unit, unit
   price. Import summary, missing-column rejection, non-numeric
   skip.

### Halt conditions for this cluster

- **HALT (A1 fires) — supplier API selection.** If Architect cannot
  identify an operator-pre-arranged supplier API choice + credentials,
  ESCALATE with bounded question:
  - Option A: Home Depot Pro API (requires Pro account + dev key)
  - Option B: Lowe's Pro API (requires Pro account)
  - Option C: stub the live integration; ship CSV import only
    (degrade FR-SUP-03 to partial)
- **HALT — credentials missing.** Even with API selected, if no
  credentials in env, write DIAGNOSTIC with operator-action
  request.

### Acceptance criteria (preliminary; Architect refines)

- **AC-R56-01:** New `SupplierCatalog` provider abstraction with
  at least one concrete implementation (the selected supplier).
- **AC-R56-02:** `searchSupplierCatalog(query, zip)` returns array
  of `{sku, description, unitPrice, unit, availability}` on success;
  falls back gracefully on API failure with cached-price warning.
- **AC-R56-03:** CSV supplier import works analogously to
  WU-P3.3's import. Required columns SKU/description/unit/unitPrice.
- **AC-R56-04:** Cached fallback message exact literal "Live
  pricing unavailable — using last cached price from [date]"
  (AC-literal-pass).
- **AC-R56-05:** No-results message + manual-entry fallback.
- **AC-R56-06:** All 5 binding commands. test:e2e actually run.
- **AC-R56-07:** SHA-A invariant.

### Anti-scope

- No price-snapshot freezing (WU-P3.5).
- No price-discrepancy flagging (WU-P3.5).
- No price-change alerts (WU-P4.1).
- No multi-supplier price comparison.

### Reinforcements

- **HALT umbrella:** ESCALATE on supplier selection if not
  pre-arranged.
- **Empirical-verification:** new API dep — verify `next build`
  succeeds with the dependency imported, before claiming "no
  next.config.ts change needed."
- **§2.x manifest:** new provider, new schema (cache table?), new
  CSV import; inventory.

### Cluster context (Wave 6a, FULL tier)

Parallel with wu-p3-1, wu-p3-2, wu-p3-3, wu-p3-6. Disjoint scope.
This cluster is the LONGEST in Wave 6a (full tier, external API);
expect 90-120 min wall.

WU-P3.5 (live-vs-cached) and WU-P4.1 (price alerts) depend on this
cluster's outputs; both deferred to Wave 6b until R56 lands.
