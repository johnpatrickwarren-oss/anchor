"""Regional tax.

Tax applies to the discounted subtotal (subtotal minus discount) at a
flat rate per customer region. Rates are decimal strings; rounding is
the shared half-up policy in billing.currency.apply_rate.

The rate table is the 2026 filing snapshot for the regions we invoice
in. An unknown region is a hard error — silently taxing at zero is how
a filing gap becomes an audit finding.
"""

from . import currency
from .errors import BillingError

#: Region code -> combined rate, as a decimal string.
RATES = {
    "CA": "0.0725",
    "MA": "0.0625",
    "NY": "0.08875",
    "TX": "0.0825",
    "WA": "0.065",
}


def rate_for(region):
    """Return the tax rate string for *region*, or raise BillingError."""
    try:
        return RATES[region]
    except KeyError:
        raise BillingError(f"no tax rate on file for region {region!r}") from None


def tax_cents(region, taxable_cents):
    """Compute tax in cents on *taxable_cents* for *region*."""
    if taxable_cents < 0:
        raise BillingError(f"taxable amount is negative: {taxable_cents}")
    return currency.apply_rate(taxable_cents, rate_for(region))


def regions():
    """Sorted list of regions with a rate on file."""
    return sorted(RATES)
