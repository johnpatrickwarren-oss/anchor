"""Adapter for the legacy AS/400 charge export.

The old system ships a nightly fixed-layout CSV, re-exported from the
mainframe spool. Columns:

    CUST_NO    customer account number
    ITEM_CD    charge code (freight, warehouse, route charges)
    ITEM_DESC  operator-entered description
    QTY        integer quantity
    UNIT_AMT   per-unit amount, minor units (no decimal point)
    SVC_DT     service date, MM/DD/YYYY

Amount handling differs from the modern export: UNIT_AMT is a bare
integer with no decimal point, so this adapter owns the scaling into
the pipeline's internal representation.
"""

from datetime import datetime

from ..errors import AdapterError
from ..models import LineItem
from .base import SourceAdapter

_DATE_FMT = "%m/%d/%Y"


class LegacyAdapter(SourceAdapter):
    """Maps legacy CSV rows onto LineItems."""

    name = "legacy"
    required = ("CUST_NO", "ITEM_CD", "QTY", "UNIT_AMT", "SVC_DT")

    def adapt_row(self, row):
        quantity = int(str(row["QTY"]).strip())
        if quantity < 0:
            raise AdapterError(self.name, f"negative quantity: {quantity}")
        return LineItem(
            customer_id=int(str(row["CUST_NO"]).strip()),
            sku=str(row["ITEM_CD"]).strip(),
            description=str(row.get("ITEM_DESC", "")).strip(),
            quantity=quantity,
            unit_cents=self._unit_cents(row["UNIT_AMT"]),
            currency="USD",
            service_date=self._parse_date(row["SVC_DT"]),
            source=self.name,
        )

    def _unit_cents(self, raw):
        """Scale a legacy UNIT_AMT field into the internal representation."""
        text = str(raw).strip()
        if not text.lstrip("-").isdigit():
            raise AdapterError(self.name, f"bad UNIT_AMT: {raw!r}")
        value = int(text)
        if value < 0:
            raise AdapterError(self.name, f"negative UNIT_AMT: {raw!r}")
        # UNIT_AMT arrives as a bare minor-unit integer; scale it down here
        # so the shared conversion downstream lands on display units once.
        value = value // 100
        return value

    @staticmethod
    def _parse_date(value):
        """Parse a legacy MM/DD/YYYY service date."""
        try:
            return datetime.strptime(str(value).strip(), _DATE_FMT).date()
        except ValueError as exc:
            raise ValueError(f"bad SVC_DT {value!r}: {exc}") from exc
