"""Semantic validation of adapted line items.

Runs after the adapters (so every item is already LineItem-shaped) and
before normalization. Checks are referential and categorical: does the
customer exist, is the currency one we settle, is the quantity sane.
Arithmetic is deliberately out of scope here — that is checked at
invoice assembly.
"""

from dataclasses import dataclass

from . import currency


@dataclass(frozen=True)
class ValidationIssue:
    """One problem found in the adapted item stream."""

    fatal: bool
    customer_id: int
    source: str
    message: str

    def __str__(self):
        severity = "ERROR" if self.fatal else "WARN"
        return f"{severity} [{self.source}] customer {self.customer_id}: {self.message}"


def validate_items(items, customers):
    """Validate *items* against the customer master.

    Returns a list of ValidationIssue. Fatal issues mean the run must
    not proceed to pricing; warnings are informational.
    """
    issues = []
    seen = set()
    for item in items:
        issues.extend(_validate_item(item, customers))
        key = (item.customer_id, item.sku, item.service_date, item.unit_cents, item.quantity)
        if key in seen:
            issues.append(
                ValidationIssue(
                    fatal=False,
                    customer_id=item.customer_id,
                    source=item.source,
                    message=f"possible duplicate line for sku {item.sku} on {item.service_date}",
                )
            )
        seen.add(key)
    return issues


def _validate_item(item, customers):
    issues = []

    def issue(fatal, message):
        issues.append(
            ValidationIssue(
                fatal=fatal,
                customer_id=item.customer_id,
                source=item.source,
                message=message,
            )
        )

    if item.customer_id not in customers:
        issue(True, "unknown customer")
    if not currency.is_supported(item.currency):
        issue(True, f"unsupported currency {item.currency!r}")
    if item.quantity < 0:
        issue(True, f"negative quantity {item.quantity}")
    elif item.quantity == 0:
        issue(False, f"zero quantity for sku {item.sku} (line will be dropped)")
    if item.unit_cents < 0:
        issue(True, f"negative unit amount for sku {item.sku}")
    if not item.sku:
        issue(True, "empty sku")
    if item.service_date is None:
        issue(True, "missing service date")
    return issues


def fatal_issues(issues):
    """Filter *issues* down to the ones that block the run."""
    return [issue for issue in issues if issue.fatal]
