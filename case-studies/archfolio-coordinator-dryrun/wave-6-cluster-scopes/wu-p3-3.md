## Round R55 scope (Wave 6a cluster wu-p3-3) — current round

R55 ships **WU-P3.3** from `WAVE-PLAN-01.md`. One PRD FR:
**FR-INT-05 (material price list CSV import)**. Audit tier. Reads
R43's PriceListItem schema.

### Tier verdict

**Tier:** `audit`. Extends R43 manual price list with bulk-import.

### Scope

**In scope:**

1. **`importPriceListCsv(firmId, csvBuffer)`** — parses CSV with
   columns SKU, description, unit, price, category. Per AC-INT-05-1:
   - Valid rows added to manual price list
   - Summary returned: `"X items imported, Y skipped"`
   - Skipped rows in error report with reasons
2. **Duplicate SKU handling** — per AC-INT-05-2: conflict report
   with options "Overwrite existing" or "Skip" (per-row or
   global).
3. **Size limits** — per AC-INT-05-3: reject files >10MB or >10,000
   rows with a specific error message and split suggestion.
4. **Admin UI** — file upload form on price-list settings page;
   shows summary + downloadable error report.

### Acceptance criteria

- **AC-R55-01:** Valid CSV imports all rows. Test: upload 100-row
  CSV; assert 100 PriceListItem rows created; summary says
  `"100 items imported, 0 skipped"` (AC-literal-pass).
- **AC-R55-02:** Missing required column rejected. Test: CSV
  without `unit` column → error mentions missing column;
  downloadable template available.
- **AC-R55-03:** Non-numeric price row skipped. Test: 5 valid + 1
  bad-price row → 5 imported, 1 skipped with reason in report.
- **AC-R55-04:** Duplicate SKU conflict. Test: import a CSV with
  SKU "ABC"; then re-import with same SKU + different price.
  Without overwrite flag: row skipped. With overwrite: row
  updated.
- **AC-R55-05:** Size limit enforcement. Test: 12MB file → rejected
  with "file exceeds 10MB limit" message + split suggestion.
- **AC-R55-06:** Audit event `price_list.imported` emitted with
  metadata (imported count, skipped count) on success.
- **AC-R55-07:** All 5 binding commands. test:e2e actually run.
- **AC-R55-08:** SHA-A invariant.

### Anti-scope

- No live catalog integration (parallel cluster wu-p3-4).
- No re-import scheduling / cron.
- No image / asset attachment in CSV.

### Reinforcements

- **AC-literal-pass:** summary text + error messages verbatim.
- **Anti-self-confirming:** import-summary assertion reads actual
  PriceListItem rows from DB, not setup.
- **§2.x manifest:** likely new files = import action + CSV
  parser; inventory.

### Cluster context (Wave 6a)

Parallel with wu-p3-1, wu-p3-2, wu-p3-4, wu-p3-6. Disjoint scope:
this cluster touches `src/lib/csv/price-list-import.ts` (new) +
price-list settings page.
