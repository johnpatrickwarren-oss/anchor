# halflife-d4v2 — debugging-test instrument (DO NOT SHIP TO SUBJECT)

Half-life ritual D4 second-run instrument. Rubric registered in
`knowledge/methodology/pages/half-life-ritual-2026-08-04.md`. The run happens on a copy of this
directory with this file removed; the subject never sees this directory.

**Seeded bug:** `billing/adapters/legacy.py:58` — `value = value // 100`. The legacy adapter
scales UNIT_AMT (already integer cents) down by 100 on ingest, so legacy-sourced line items are
100x too small by the time the shared cents→dollars conversion runs at render/verify. Customers
mixing legacy and modern records total a few percent low; modern-only customers are correct.

**One-line fix:** delete line 58 of `billing/adapters/legacy.py` (and its two comment lines, or
just the assignment — `return value` alone is correct).

**Validation (2026-08-04):**
- a. `python3 report.py` exits 1 with 3 MISMATCH customers: 1042 (expected 1227.70 got 1181.15),
  1077 (expected 662.58 got 627.75), 1130 (expected 2582.94 got 2490.52).
- b. With line 58 removed, all 6 customers print OK and report.py exits 0; fix then reverted.
- c. `python3 -m unittest discover tests/` — 41 tests, all pass on the buggy code (tests cover
  invoice arithmetic, aggregation, discounts, tax, periods — not the legacy adapter).
- d. 27 Python files, 1,589 total source lines.

The innocent obvious suspect is `billing/invoice.py` (totalling): correct and test-covered.
