"""Aggregation: fold the flat item stream into per-customer rollups.

Grouping is by customer, then by (SKU, unit price) inside the customer.
The result preserves enough detail to render an invoice body while
giving the pricing stages a single subtotal to work from.
"""

from .models import CustomerAggregate


def aggregate_items(items):
    """Group *items* into {customer_id: CustomerAggregate}.

    Aggregate lines within each customer are sorted by SKU (then unit
    price) so invoice bodies render deterministically regardless of
    source file ordering.
    """
    by_customer = {}
    for item in items:
        agg = by_customer.get(item.customer_id)
        if agg is None:
            agg = CustomerAggregate(customer_id=item.customer_id)
            by_customer[item.customer_id] = agg
        agg.add(item)

    for agg in by_customer.values():
        agg.lines.sort(key=lambda line: (line.sku, line.unit_cents))
    return by_customer


def total_activity_cents(aggregates):
    """Sum of every customer's subtotal — the period's gross activity."""
    return sum(agg.subtotal_cents for agg in aggregates.values())


def line_count(aggregates):
    """Total number of aggregate lines across all customers."""
    return sum(len(agg.lines) for agg in aggregates.values())
