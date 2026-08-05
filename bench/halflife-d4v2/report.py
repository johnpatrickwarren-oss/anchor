#!/usr/bin/env python3
"""Quarterly invoice report — 2026 Q2.

Usage:
    python3 report.py

Loads the fixture exports under data/, runs the full billing pipeline,
prints each customer's invoice total, then verifies every total against
data/expected_totals.json (maintained by finance against the published
rate card). Exits 0 when all totals match, 1 otherwise.

Stdlib only; no network; deterministic.
"""

import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from billing import aggregate, currency, invoice, normalize, periods, render, validation
from billing.adapters import LegacyAdapter, ModernAdapter
from billing.io import loader

DATA = ROOT / "data"
PERIOD = periods.quarter(2026, 2)

_SOURCES = (
    (ModernAdapter, "modern_2026q2.jsonl"),
    (LegacyAdapter, "legacy_charges.csv"),
)


def build_invoices():
    """Run the pipeline end to end and return a sorted list of Invoices."""
    customers = loader.load_customers(DATA / "customers.csv")

    items = []
    for adapter_cls, filename in _SOURCES:
        rows = loader.read_rows(DATA / filename)
        items.extend(adapter_cls().adapt(rows))

    issues = validation.validate_items(items, customers)
    for issue in issues:
        print(issue, file=sys.stderr)
    if validation.fatal_issues(issues):
        raise SystemExit("fatal validation issues; aborting")

    items = normalize.normalize_items(items)
    items = periods.filter_items(items, PERIOD)

    aggregates = aggregate.aggregate_items(items)
    return [
        invoice.build_invoice(customers[customer_id], PERIOD, aggregates[customer_id])
        for customer_id in sorted(aggregates)
    ]


def verify(invoices, expected):
    """Compare invoice totals to the expected fixture.

    Prints one OK/MISMATCH line per customer and returns the mismatch
    count.
    """
    mismatches = 0
    for inv in invoices:
        customer_id = inv.customer.customer_id
        got = currency.cents_to_dollars(inv.total_cents)
        want_text = expected.get(str(customer_id))
        if want_text is None:
            print(f"MISMATCH customer {customer_id}: no expected total on file")
            mismatches += 1
            continue
        want = Decimal(want_text)
        if got == want:
            print(f"OK customer {customer_id}: total {want}")
        else:
            print(f"MISMATCH customer {customer_id}: expected {want} got {got}")
            mismatches += 1
    return mismatches


def main():
    invoices = build_invoices()

    print(f"Invoice report — {PERIOD.label} "
          f"({PERIOD.start.isoformat()} .. {PERIOD.end.isoformat()})")
    print()
    for inv in invoices:
        print(render.summary_line(inv))
    print()

    expected = loader.load_expected_totals(DATA / "expected_totals.json")
    mismatches = verify(invoices, expected)
    print()
    if mismatches:
        print(f"{mismatches} customer(s) with wrong totals")
        return 1
    print("all customer totals match expected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
