"""Tests for invoice assembly and arithmetic (billing.invoice)."""

import unittest

from billing import invoice, periods
from billing.errors import ArithmeticDriftError
from billing.models import AggregateLine, Customer, CustomerAggregate

PERIOD = periods.quarter(2026, 2)


def _aggregate(customer_id, lines):
    agg = CustomerAggregate(customer_id=customer_id)
    agg.lines.extend(lines)
    return agg


def _line(sku, quantity, unit_cents):
    return AggregateLine(
        sku=sku,
        description=f"test line {sku}",
        quantity=quantity,
        unit_cents=unit_cents,
        amount_cents=quantity * unit_cents,
    )


class BuildInvoiceTest(unittest.TestCase):
    def test_standard_tier_below_threshold_gets_no_discount(self):
        customer = Customer(1, "Test Co", "MA", "standard")
        agg = _aggregate(1, [_line("PLAN", 1, 29900), _line("SEAT", 4, 2500)])
        inv = invoice.build_invoice(customer, PERIOD, agg)
        self.assertEqual(inv.subtotal_cents, 39900)
        self.assertEqual(inv.discount_cents, 0)
        # MA 6.25% of 39900 = 2493.75 -> 2494 half-up
        self.assertEqual(inv.tax_cents, 2494)
        self.assertEqual(inv.total_cents, 42394)

    def test_volume_tier_discount_applies_before_tax(self):
        customer = Customer(2, "Volume Co", "NY", "volume")
        agg = _aggregate(2, [_line("PLAN-ENT", 2, 74900)])  # $1,498.00
        inv = invoice.build_invoice(customer, PERIOD, agg)
        self.assertEqual(inv.subtotal_cents, 149800)
        self.assertEqual(inv.discount_rate, "0.03")
        self.assertEqual(inv.discount_cents, 4494)
        # taxable 145306, NY 8.875% = 12895.9075 -> 12896
        self.assertEqual(inv.tax_cents, 12896)
        self.assertEqual(inv.total_cents, 145306 + 12896)

    def test_total_is_taxable_plus_tax_exactly(self):
        customer = Customer(3, "Exact Co", "CA", "standard")
        agg = _aggregate(3, [_line("SKU-A", 3, 1850), _line("SKU-B", 1, 14900)])
        inv = invoice.build_invoice(customer, PERIOD, agg)
        self.assertEqual(
            inv.total_cents,
            inv.subtotal_cents - inv.discount_cents + inv.tax_cents,
        )

    def test_zero_subtotal_invoice_totals_zero(self):
        customer = Customer(4, "Empty Co", "WA", "standard")
        agg = _aggregate(4, [])
        inv = invoice.build_invoice(customer, PERIOD, agg)
        self.assertEqual(inv.subtotal_cents, 0)
        self.assertEqual(inv.discount_cents, 0)
        self.assertEqual(inv.tax_cents, 0)
        self.assertEqual(inv.total_cents, 0)

    def test_period_label_recorded(self):
        customer = Customer(5, "Label Co", "TX", "standard")
        inv = invoice.build_invoice(customer, PERIOD, _aggregate(5, [_line("X", 1, 100)]))
        self.assertEqual(inv.period_label, "2026 Q2")


class CheckInvoiceTest(unittest.TestCase):
    def _valid_invoice(self):
        customer = Customer(9, "Check Co", "NY", "volume")
        agg = _aggregate(9, [_line("PLAN", 1, 250000)])
        return invoice.build_invoice(customer, PERIOD, agg)

    def test_built_invoice_passes_check(self):
        inv = self._valid_invoice()
        invoice.check_invoice(inv)  # must not raise

    def test_tampered_total_is_caught(self):
        inv = self._valid_invoice()
        inv.total_cents += 1
        with self.assertRaises(ArithmeticDriftError):
            invoice.check_invoice(inv)

    def test_tampered_subtotal_is_caught(self):
        inv = self._valid_invoice()
        inv.subtotal_cents -= 100
        with self.assertRaises(ArithmeticDriftError):
            invoice.check_invoice(inv)

    def test_tampered_line_amount_is_caught(self):
        inv = self._valid_invoice()
        inv.lines[0].amount_cents += 5
        with self.assertRaises(ArithmeticDriftError):
            invoice.check_invoice(inv)


if __name__ == "__main__":
    unittest.main()
