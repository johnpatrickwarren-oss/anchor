"""Tests for billing periods and bucketing (billing.periods)."""

import unittest
from datetime import date

from billing import periods
from billing.models import LineItem


def _item(day, month=5):
    return LineItem(
        customer_id=1,
        sku="X",
        description="x",
        quantity=1,
        unit_cents=100,
        currency="USD",
        service_date=date(2026, month, day),
        source="modern",
    )


class QuarterTest(unittest.TestCase):
    def test_q2_bounds(self):
        period = periods.quarter(2026, 2)
        self.assertEqual(period.start, date(2026, 4, 1))
        self.assertEqual(period.end, date(2026, 6, 30))
        self.assertEqual(period.label, "2026 Q2")

    def test_q4_crosses_year_end_correctly(self):
        period = periods.quarter(2026, 4)
        self.assertEqual(period.end, date(2026, 12, 31))

    def test_bad_quarter_rejected(self):
        with self.assertRaises(ValueError):
            periods.quarter(2026, 5)

    def test_contains_is_inclusive(self):
        period = periods.quarter(2026, 2)
        self.assertTrue(period.contains(date(2026, 4, 1)))
        self.assertTrue(period.contains(date(2026, 6, 30)))
        self.assertFalse(period.contains(date(2026, 3, 31)))
        self.assertFalse(period.contains(date(2026, 7, 1)))


class FilterItemsTest(unittest.TestCase):
    def test_out_of_period_items_dropped(self):
        period = periods.quarter(2026, 2)
        kept = periods.filter_items(
            [_item(15, month=3), _item(15, month=5), _item(1, month=7)], period
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].service_date, date(2026, 5, 15))

    def test_split_by_month_buckets_and_sorts(self):
        buckets = periods.split_by_month([_item(2, month=6), _item(9, month=4)])
        self.assertEqual(list(buckets), [(2026, 4), (2026, 6)])


if __name__ == "__main__":
    unittest.main()
