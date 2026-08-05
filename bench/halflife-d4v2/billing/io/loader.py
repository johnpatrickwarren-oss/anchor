"""High-level loading: dispatch by file type, plus fixture-specific loaders."""

import json
from pathlib import Path

from ..errors import LoadError
from ..models import Customer
from .csvio import read_csv
from .jsonl import read_jsonl

_READERS = {
    ".csv": read_csv,
    ".jsonl": read_jsonl,
}


def read_rows(path):
    """Read any supported fixture file into a list of row dicts."""
    suffix = Path(path).suffix.lower()
    reader = _READERS.get(suffix)
    if reader is None:
        raise LoadError(path, f"unsupported file type {suffix!r}")
    return reader(path)


def load_customers(path):
    """Load the customer master file into {customer_id: Customer}."""
    customers = {}
    for row in read_csv(path):
        try:
            customer = Customer(
                customer_id=int(row["customer_id"]),
                name=row["name"].strip(),
                region=row["region"].strip().upper(),
                tier=row["tier"].strip().lower(),
            )
        except (KeyError, ValueError) as exc:
            raise LoadError(path, f"bad customer row {row!r}: {exc}") from exc
        if customer.customer_id in customers:
            raise LoadError(path, f"duplicate customer_id {customer.customer_id}")
        customers[customer.customer_id] = customer
    if not customers:
        raise LoadError(path, "no customers loaded")
    return customers


def load_expected_totals(path):
    """Load the expected-totals fixture: {customer_id_str: dollar_str}.

    The totals in this file are maintained against the published billing
    terms (rates, tiers, rounding) and serve as the report's oracle.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise LoadError(path, f"cannot read: {exc.strerror}") from exc
    except json.JSONDecodeError as exc:
        raise LoadError(path, f"invalid JSON: {exc.msg}") from exc
    if not isinstance(data, dict) or not data:
        raise LoadError(path, "expected a non-empty object of customer totals")
    return {str(key): str(value) for key, value in data.items()}
