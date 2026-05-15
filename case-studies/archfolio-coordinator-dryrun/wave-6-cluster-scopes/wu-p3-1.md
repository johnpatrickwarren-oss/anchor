## Round R53 scope (Wave 6a cluster wu-p3-1) — current round

R53 ships **WU-P3.1** from `WAVE-PLAN-01.md`. Two PRD FRs:
**FR-INT-01 (quote/estimate PDF export)** + **FR-INT-03 (estimate CSV
export)**. Audit tier. Extends existing R08 quote PDF + new CSV
serializer.

### Tier verdict

**Tier:** `audit`. A-factors all FALSE. S1 (reuses R08 PDF infra +
existing line-item data shape).

### Scope

**In scope:**

1. **`exportQuoteToPdf(estimateId)`** — returns PDF buffer +
   suggested filename `[ProjectName]_Quote_v[Version]_[Date].pdf`
   per AC-INT-01-1. Reuses R08's quote-PDF renderer (existing
   `src/lib/pdf/`). For estimates with >200 line items
   (AC-INT-01-2): paginate; repeat section headers at page breaks;
   generation completes within 15s.
2. **`exportEstimateToCsv(estimateId)`** — returns CSV string with
   columns: Section, Line Item Description, Category, Quantity,
   Unit, Unit Price, Line Total, Markup, Tax Applied (Y/N), Notes
   per AC-INT-03-1. Standard CSV escaping. Column header row first.
3. **Admin UI affordances** — "Export PDF" + "Export to CSV" buttons
   on estimate detail page. Both trigger downloads.
4. **Audit-event emission** on each export (`quote.exported_pdf`,
   `quote.exported_csv`) gated on `result.ok`.

### Acceptance criteria

- **AC-R53-01:** `exportQuoteToPdf` returns a valid PDF buffer for
  any estimate. Test: create estimate; call function; assert
  return is non-empty Buffer; first 4 bytes are `%PDF`.
- **AC-R53-02:** PDF filename matches `[ProjectName]_Quote_v[N]_[YYYY-MM-DD].pdf`.
  Per AC-literal-pass umbrella, assert exact pattern.
- **AC-R53-03:** >200 line items paginated. Test: create estimate
  with 250 items; call exportQuoteToPdf; assert PDF generation
  completes <15s; assert PDF has multiple pages (count via
  pdf-parse or similar).
- **AC-R53-04:** `exportEstimateToCsv` returns valid CSV with all
  10 columns. Test: parse the returned CSV; assert header row
  matches `Section,Line Item Description,Category,Quantity,Unit,Unit Price,Line Total,Markup,Tax Applied,Notes`
  exactly (AC-literal-pass).
- **AC-R53-05:** Tax column `Y/N` per line item. Test asserts a
  materials item (taxed) shows `Y`; labor item (not taxed) shows
  `N`.
- **AC-R53-06:** Both export actions emit audit events on success;
  no emission on failure (e.g., estimate not found). Standard
  failure-path gating.
- **AC-R53-07:** All 5 binding commands exit 0. test:e2e actually
  run (R47 reinforcement).
- **AC-R53-08:** SHA-A invariant.

### Anti-scope

- No QuickBooks/Xero auto-import wiring (mentioned in AC-INT-03-2
  as compatibility goal but not a build requirement — column names
  align "naturally").
- No PDF design polish beyond R08's existing template.

### Reinforcements (call-outs)

- **AC-literal-pass:** filename pattern + CSV header verbatim.
- **Anti-self-confirming (skills/13):** assertions on PDF binary
  content + CSV parse must read actual output, not setup.

### Cluster context (Wave 6a)

Parallel with wu-p3-2, wu-p3-3, wu-p3-4, wu-p3-6. Disjoint file
scopes: this cluster touches `src/lib/pdf/quote.ts` + new
`src/lib/csv/estimate.ts` + estimate-detail page.
