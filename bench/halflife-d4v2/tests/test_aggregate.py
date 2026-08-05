"""Tests for per-customer aggregation (billing.aggregate)."""

import unittest
from datetime import date

from billing import aggregate
from billing.models import LineItem


def _item(customer_id, sku, quantity, unit_cents, day=15):
    return LineItem(
        customer_id=customer_id,
        sku=sku,
        description=f"desc {sku}",
        quantity=quantity,
        unit_cents=unit_cents,
        currency="USD",
        service_date=date(2026, 5, day),
        source="modern",
    )


class AggregateItemsTest(unittest.TestCase):
    def test_items_group_by_customer(self):
        aggs = aggregate.aggregate_items(
            [_item(1, "A", 1, 100), _item(2, "A", 1, 100), _item(1, "B", 1, 200)]
        )
        self.assertEqual(sorted(aggs), [1, 2])
        self.assertEqual(len(aggs[1].lines), 2)
        self.assertEqual(len(aggs[2].lines), 1)

    def test_same_sku_same_price_merges(self):
        aggs = aggregate.aggregate_items(
            [_item(1, "SEAT", 4, 2500, day=1), _item(1, "SEAT", 2, 2500, day=20)]
        )
        (line,) = aggs[1].lines
        self.assertEqual(line.quantity, 6)
        self.assertEqual(line.amount_cents, 15000)

    def test_same_sku_different_price_stays_split(self):
        aggs = aggregate.aggregate_items(
            [_item(1, "SEAT", 1, 2500), _item(1, "SEAT", 1, 3000)]
        )
        self.assertEqual(len(aggs[1].lines), 2)
        self.assertEqual(aggs[1].subtotal_cents, 5500)

    def test_subtotal_is_sum_of_extended_amounts(self):
        aggs = aggregate.aggregate_items(
            [_item(1, "A", 3, 1850), _item(1, "B", 1, 14900), _item(1, "C", 2, 4000)]
        )
        self.assertEqual(aggs[1].subtotal_cents, 3 * 1850 + 14900 + 2 * 4000)

    def test_lines_sorted_by_sku(self):
        aggs = aggregate.aggregate_items(
            [_item(1, "ZULU", 1, 100), _item(1, "ALFA", 1, 100), _item(1, "MIKE", 1, 100)]
        )
        self.assertEqual([line.sku for line in aggs[1].lines], ["ALFA", "MIKE", "ZULU"])

    def test_helpers_count_activity(self):
        aggs = aggregate.aggregate_items([_item(1, "A", 1, 100), _item(2, "B", 2, 50)])
        self.assertEqual(aggregate.total_activity_cents(aggs), 200)
        self.assertEqual(aggregate.line_count(aggs), 2)

    def test_empty_stream_aggregates_to_nothing(self):
        self.assertEqual(aggregate.aggregate_items([]), {})


if __name__ == "__main__":
    unittest.main()
