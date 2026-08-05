"""Exception types for the billing pipeline.

Every error raised by pipeline code derives from BillingError so callers
can catch one type at the top level. Subtypes exist so tests and the
report driver can distinguish load-time trouble from data trouble.
"""


class BillingError(Exception):
    """Base class for all billing pipeline errors."""


class LoadError(BillingError):
    """A fixture file could not be read or parsed at the container level
    (missing file, malformed CSV/JSONL framing)."""

    def __init__(self, path, message):
        self.path = str(path)
        super().__init__(f"{self.path}: {message}")


class AdapterError(BillingError):
    """A source adapter could not map a row onto a LineItem."""

    def __init__(self, source, message, lineno=None):
        self.source = source
        self.lineno = lineno
        where = f"{source} row {lineno}" if lineno is not None else source
        super().__init__(f"{where}: {message}")


class ValidationError(BillingError):
    """A record failed a semantic check (unknown customer, bad currency)."""


class CurrencyError(BillingError):
    """A monetary value could not be parsed or is in an unsupported
    currency."""


class ArithmeticDriftError(BillingError):
    """An assembled invoice failed its internal arithmetic re-check.

    Raised by billing.invoice.check_invoice when a stored figure does not
    equal the value recomputed from the invoice's own inputs.
    """
