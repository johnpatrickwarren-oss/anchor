"""Shared normalization pass.

Adapters emit LineItems whose money fields are integer cents. This pass
enforces that invariant before pricing:

- currency must be settleable (FX hook below for future currencies)
- quantity and unit_cents must be ints (adapters returning bools or
  Decimals is a bug this pass turns into a loud failure)
- zero-quantity lines are dropped
- descriptions are trimmed to the render width

Note on units: cents are the internal representation end to end. The
conversion to display dollars happens once, downstream, at render time
(billing.currency.cents_to_dollars). Nothing in this pass rescales an
amount; adapters hand over cents and cents leave here untouched.
"""

from dataclasses import replace

from . import currency
from .errors import BillingError

#: Settlement conversion table. Only USD today; rates are expressed as
#: minor-units-per-minor-unit so adding a currency does not change the
#: integer-cents invariant.
_FX_TO_USD = {
    "USD": 1,
}

#: Longest description the renderer will show.
_MAX_DESCRIPTION = 60


def normalize_items(items):
    """Normalize a list of LineItems, dropping empty lines."""
    normalized = []
    for item in items:
        if item.quantity == 0:
            continue
        normalized.append(_normalize(item))
    return normalized


def _normalize(item):
    if item.currency not in _FX_TO_USD:
        raise BillingError(
            f"cannot settle {item.currency!r} for customer {item.customer_id}"
        )
    _require_int("quantity", item.quantity)
    _require_int("unit_cents", item.unit_cents)

    fx = _FX_TO_USD[item.currency]
    unit_cents = item.unit_cents * fx

    description = " ".join(item.description.split())
    if len(description) > _MAX_DESCRIPTION:
        description = description[: _MAX_DESCRIPTION - 1] + "…"

    if unit_cents == item.unit_cents and description == item.description:
        return item
    return replace(item, unit_cents=unit_cents, description=description)


def _require_int(name, value):
    """Reject anything that is not a genuine int (bool included)."""
    if not isinstance(value, int) or isinstance(value, bool):
        raise BillingError(
            f"{name} must be int cents, got {type(value).__name__}: {value!r}"
        )
