"""Data model for the billing pipeline.

All money fields hold integer cents. The only Decimal values in the
system are transient: parsing on ingest and formatting on render.
"""

from dataclasses import dataclass, field
from datetime import date as Date


@dataclass(frozen=True)
class Customer:
    """A billable account, loaded from data/customers.csv."""

    customer_id: int
    name: str
    region: str
    tier: str

    def __post_init__(self):
        if self.customer_id <= 0:
            raise ValueError(f"customer_id must be positive: {self.customer_id}")


@dataclass
class LineItem:
    """One billable line as emitted by a source adapter.

    ``unit_cents`` is the per-unit price in integer cents regardless of
    which source produced the item; adapters are responsible for getting
    the row into that shape.
    """

    customer_id: int
    sku: str
    description: str
    quantity: int
    unit_cents: int
    currency: str
    service_date: Date
    source: str

    @property
    def amount_cents(self):
        """Extended amount for the line: quantity times unit price."""
        return self.quantity * self.unit_cents


@dataclass
class AggregateLine:
    """A per-SKU rollup of one or more LineItems for a single customer."""

    sku: str
    description: str
    quantity: int
    unit_cents: int
    amount_cents: int


@dataclass
class CustomerAggregate:
    """All of one customer's activity in the period, grouped by SKU."""

    customer_id: int
    lines: list = field(default_factory=list)

    def add(self, item):
        """Fold a LineItem into the rollup.

        Items merge when both the SKU and the unit price match; a price
        change mid-period therefore produces two aggregate lines, which
        is what the rendered invoice should show.
        """
        for line in self.lines:
            if line.sku == item.sku and line.unit_cents == item.unit_cents:
                line.quantity += item.quantity
                line.amount_cents += item.amount_cents
                return
        self.lines.append(
            AggregateLine(
                sku=item.sku,
                description=item.description,
                quantity=item.quantity,
                unit_cents=item.unit_cents,
                amount_cents=item.amount_cents,
            )
        )

    @property
    def subtotal_cents(self):
        """Sum of all aggregate line amounts, in cents."""
        return sum(line.amount_cents for line in self.lines)


@dataclass
class Invoice:
    """A fully priced invoice for one customer and one period."""

    customer: Customer
    period_label: str
    lines: list
    subtotal_cents: int
    discount_rate: str
    discount_cents: int
    tax_rate: str
    tax_cents: int
    total_cents: int
