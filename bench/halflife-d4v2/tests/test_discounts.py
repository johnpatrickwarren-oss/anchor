"""Tests for tiered volume discounts (billing.discounts)."""

import unittest

from billing import discounts


class RateForTest(unittest.TestCase):
    def test_volume_tier_below_first_threshold(self):
        self.assertEqual(discounts.rate_for("volume", 99_999), "0")

    def test_volume_tier_at_three_percent_threshold(self):
        self.assertEqual(discounts.rate_for("volume", 100_000), "0.03")

    def test_volume_tier_just_below_five_percent_threshold(self):
        self.assertEqual(discounts.rate_for("volume", 199_999), "0.03")

    def test_volume_tier_at_five_percent_threshold(self):
        self.assertEqual(discounts.rate_for("volume", 200_000), "0.05")

    def test_standard_tier_thresholds(self):
        self.assertEqual(discounts.rate_for("standard", 499_999), "0")
        self.assertEqual(discounts.rate_for("standard", 500_000), "0.02")

    def test_unknown_tier_gets_no_discount(self):
        self.assertEqual(discounts.rate_for("mystery", 10_000_000), "0")

    def test_zero_subtotal_gets_no_discount(self):
        self.assertEqual(discounts.rate_for("volume", 0), "0")


class DiscountCentsTest(unittest.TestCase):
    def test_exact_percentages(self):
        self.assertEqual(discounts.discount_cents("volume", 200_000), 10_000)
        self.assertEqual(discounts.discount_cents("volume", 100_000), 3_000)

    def test_rounding_half_up_on_fractional_cent(self):
        # 3% of 116249 = 3487.47 -> 3487
        self.assertEqual(discounts.discount_cents("volume", 116_249), 3_487)
        # 5% of 249725 = 12486.25 -> 12486
        self.assertEqual(discounts.discount_cents("volume", 249_725), 12_486)
        # 3% of 100050 = 3001.5 -> 3002 (half rounds up)
        self.assertEqual(discounts.discount_cents("volume", 100_050), 3_002)

    def test_no_discount_is_zero_cents(self):
        self.assertEqual(discounts.discount_cents("standard", 40_000), 0)


class DescribeTest(unittest.TestCase):
    def test_known_tier_mentions_every_rung(self):
        text = discounts.describe("volume")
        self.assertIn("5%", text)
        self.assertIn("3%", text)

    def test_unknown_tier_reads_as_no_discount(self):
        self.assertEqual(discounts.describe("nobody"), "no volume discount")


if __name__ == "__main__":
    unittest.main()
