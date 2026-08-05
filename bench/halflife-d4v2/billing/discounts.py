"""Volume discounts.

Discounts are tiered on the period subtotal and keyed by the customer's
contract tier. Rates are decimal strings so the shared rounding policy
in billing.currency.apply_rate is the only place a fractional cent can
be resolved.

Published terms (2026 rate card):

    volume tier:    5% at $2,000+ subtotal, 3% at $1,000+
    standard tier:  2% at $5,000+ subtotal
"""

from . import currency

#: Tier name -> list of (threshold_cents, rate_str), highest threshold
#: first. The first threshold the subtotal meets wins.
TIERS = {
    "volume": [
        (200_000, "0.05"),
        (100_000, "0.03"),
    ],
    "standard": [
        (500_000, "0.02"),
    ],
}

#: Rate applied when no threshold is met or the tier is unknown.
NO_DISCOUNT = "0"


def rate_for(tier, subtotal_cents):
    """Return the discount rate string for *tier* at *subtotal_cents*."""
    for threshold, rate in TIERS.get(tier, ()):
        if subtotal_cents >= threshold:
            return rate
    return NO_DISCOUNT


def discount_cents(tier, subtotal_cents):
    """Compute the discount amount in cents for *tier* and subtotal."""
    return currency.apply_rate(subtotal_cents, rate_for(tier, subtotal_cents))


def describe(tier):
    """Human-readable summary of a tier's ladder, for invoice footers."""
    ladder = TIERS.get(tier)
    if not ladder:
        return "no volume discount"
    parts = []
    for threshold, rate in ladder:
        pct = format(float(rate) * 100, "g")
        parts.append(f"{pct}% at {currency.format_cents(threshold)}+")
    return ", ".join(parts)
