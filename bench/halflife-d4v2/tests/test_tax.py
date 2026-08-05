"""Tests for regional tax (billing.tax)."""

import unittest

from billing import tax
from billing.errors import BillingError


class RateForTest(unittest.TestCase):
    def test_known_regions_have_rates(self):
        self.assertEqual(tax.rate_for("NY"), "0.08875")
        self.assertEqual(tax.rate_for("MA"), "0.0625")
        self.assertEqual(tax.rate_for("WA"), "0.065")

    def test_unknown_region_is_a_hard_error(self):
        with self.assertRaises(BillingError):
            tax.rate_for("ZZ")

    def test_regions_listing_is_sorted(self):
        listed = tax.regions()
        self.assertEqual(listed, sorted(listed))
        self.assertIn("CA", listed)


class TaxCentsTest(unittest.TestCase):
    def test_exact_amounts(self):
        # 6.25% of $100.00
        self.assertEqual(tax.tax_cents("MA", 10_000), 625)

    def test_rounding_half_up(self):
        # 6.25% of 1000 = 62.5 -> 63
        self.assertEqual(tax.tax_cents("MA", 1_000), 63)
        # 8.875% of 112762 = 10007.6275 -> 10008
        self.assertEqual(tax.tax_cents("NY", 112_762), 10_008)
        # 7.25% of 60350 = 4375.375 -> 4375
        self.assertEqual(tax.tax_cents("CA", 60_350), 4_375)

    def test_zero_taxable_is_zero_tax(self):
        self.assertEqual(tax.tax_cents("TX", 0), 0)

    def test_negative_taxable_rejected(self):
        with self.assertRaises(BillingError):
            tax.tax_cents("TX", -1)


if __name__ == "__main__":
    unittest.main()
