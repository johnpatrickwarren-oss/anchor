"""Currency helpers.

Invariant: every monetary amount inside the pipeline is an ``int`` count
of cents (USD minor units). Parsing from display dollars happens on the
way in (modern source only — the legacy export is already in minor
units), and conversion back to display dollars happens exactly once, on
the way out, via cents_to_dollars / format_cents.

Rounding policy is ROUND_HALF_UP everywhere a fractional cent can
appear (rate application, dollar parsing). This matches the terms
published on customer invoices.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .errors import CurrencyError

#: The only settlement currency the pipeline accepts today. The FX hook
#: in billing.normalize exists so this set can grow without reshaping
#: the pipeline.
SUPPORTED_CURRENCIES = frozenset({"USD"})

_CENT = Decimal("0.01")
_ONE = Decimal("1")


def is_supported(code):
    """Return True if *code* is a currency the pipeline can settle."""
    return isinstance(code, str) and code.upper() in SUPPORTED_CURRENCIES


def parse_dollars(text):
    """Parse a display-dollar string like ``"1,249.50"`` into int cents.

    Accepts an optional leading ``$`` and thousands separators. Raises
    CurrencyError for anything that is not a finite decimal number.
    """
    if text is None:
        raise CurrencyError("missing dollar amount")
    cleaned = str(text).strip().replace(",", "")
    if cleaned.startswith("$"):
        cleaned = cleaned[1:]
    if not cleaned:
        raise CurrencyError("empty dollar amount")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise CurrencyError(f"unparseable dollar amount: {text!r}") from exc
    if not value.is_finite():
        raise CurrencyError(f"non-finite dollar amount: {text!r}")
    cents = (value * 100).quantize(_ONE, rounding=ROUND_HALF_UP)
    return int(cents)


def cents_to_dollars(cents):
    """Convert int cents to a display Decimal with two places.

    This is the single sanctioned cents→dollars conversion in the
    pipeline; nothing upstream of rendering should call it.
    """
    if not isinstance(cents, int):
        raise CurrencyError(f"cents must be int, got {type(cents).__name__}")
    return (Decimal(cents) / 100).quantize(_CENT)


def format_cents(cents):
    """Format int cents as a display string, e.g. ``"2,582.94"``."""
    return format(cents_to_dollars(cents), ",.2f")


def apply_rate(cents, rate):
    """Apply a decimal rate string (e.g. ``"0.08875"``) to int cents.

    Returns int cents, rounded half-up. Used by both the discount and
    tax stages so the two share one rounding policy.
    """
    if not isinstance(cents, int):
        raise CurrencyError(f"cents must be int, got {type(cents).__name__}")
    try:
        factor = Decimal(str(rate))
    except InvalidOperation as exc:
        raise CurrencyError(f"unparseable rate: {rate!r}") from exc
    if factor < 0:
        raise CurrencyError(f"negative rate: {rate!r}")
    scaled = (Decimal(cents) * factor).quantize(_ONE, rounding=ROUND_HALF_UP)
    return int(scaled)
