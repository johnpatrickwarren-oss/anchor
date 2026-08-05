"""Adapter for the modern billing platform's JSONL export.

Each row is a JSON object:

    {"customer_id": 1042, "sku": "PLAN-ENT", "description": "...",
     "quantity": 1, "unit_price": "749.00", "currency": "USD",
     "date": "2026-04-01"}

``unit_price`` is a display-dollar string; this adapter converts it to
integer cents on the way in so every LineItem leaves an adapter in the
same units.
"""

from datetime import date as Date

from .. import currency
from ..errors import AdapterError
from ..models import LineItem
from .base import SourceAdapter


class ModernAdapter(SourceAdapter):
    """Maps modern JSONL rows onto LineItems."""

    name = "modern"
    required = ("customer_id", "sku", "quantity", "unit_price", "currency", "date")

    def adapt_row(self, row):
        quantity = int(row["quantity"])
        if quantity < 0:
            raise AdapterError(self.name, f"negative quantity: {quantity}")
        unit_cents = currency.parse_dollars(row["unit_price"])
        if unit_cents < 0:
            raise AdapterError(self.name, f"negative unit price: {row['unit_price']!r}")
        return LineItem(
            customer_id=int(row["customer_id"]),
            sku=str(row["sku"]).strip(),
            description=str(row.get("description", "")).strip(),
            quantity=quantity,
            unit_cents=unit_cents,
            currency=str(row["currency"]).strip().upper(),
            service_date=self._parse_date(row["date"]),
            source=self.name,
        )

    @staticmethod
    def _parse_date(value):
        """Parse an ISO date string like ``2026-04-01``."""
        try:
            return Date.fromisoformat(str(value).strip())
        except ValueError as exc:
            raise ValueError(f"bad date {value!r}: {exc}") from exc
