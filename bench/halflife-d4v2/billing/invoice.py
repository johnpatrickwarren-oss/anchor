"""Invoice assembly and arithmetic.

This module owns the money math that turns a customer's aggregate into
a priced invoice:

    subtotal  = sum of aggregate line amounts
    discount  = tier rate applied to subtotal
    taxable   = subtotal - discount
    tax       = regional rate applied to taxable
    total     = taxable + tax

Everything is integer cents; the only rounding happens inside
billing.currency.apply_rate. check_invoice re-derives every figure from
the invoice's own lines and raises if anything drifted, so a rendering
or storage bug cannot silently ship a total that disagrees with its own
line items.
"""

from . import currency, discounts, tax
from .errors import ArithmeticDriftError
from .models import Invoice


def build_invoice(customer, period, aggregate):
    """Price *aggregate* for *customer* over *period* into an Invoice."""
    subtotal_cents = aggregate.subtotal_cents
    discount_rate = discounts.rate_for(customer.tier, subtotal_cents)
    discount_cents = currency.apply_rate(subtotal_cents, discount_rate)

    taxable_cents = subtotal_cents - discount_cents
    tax_rate = tax.rate_for(customer.region)
    tax_amount = currency.apply_rate(taxable_cents, tax_rate)

    invoice = Invoice(
        customer=customer,
        period_label=period.label,
        lines=list(aggregate.lines),
        subtotal_cents=subtotal_cents,
        discount_rate=discount_rate,
        discount_cents=discount_cents,
        tax_rate=tax_rate,
        tax_cents=tax_amount,
        total_cents=taxable_cents + tax_amount,
    )
    check_invoice(invoice)
    return invoice


def check_invoice(invoice):
    """Re-derive every figure on *invoice* and raise on any drift."""
    derived_subtotal = sum(line.amount_cents for line in invoice.lines)
    if derived_subtotal != invoice.subtotal_cents:
        raise ArithmeticDriftError(
            f"customer {invoice.customer.customer_id}: subtotal "
            f"{invoice.subtotal_cents} != sum of lines {derived_subtotal}"
        )

    derived_discount = currency.apply_rate(invoice.subtotal_cents, invoice.discount_rate)
    if derived_discount != invoice.discount_cents:
        raise ArithmeticDriftError(
            f"customer {invoice.customer.customer_id}: discount "
            f"{invoice.discount_cents} != {invoice.discount_rate} of subtotal"
        )

    taxable = invoice.subtotal_cents - invoice.discount_cents
    derived_tax = currency.apply_rate(taxable, invoice.tax_rate)
    if derived_tax != invoice.tax_cents:
        raise ArithmeticDriftError(
            f"customer {invoice.customer.customer_id}: tax "
            f"{invoice.tax_cents} != {invoice.tax_rate} of taxable {taxable}"
        )

    derived_total = taxable + invoice.tax_cents
    if derived_total != invoice.total_cents:
        raise ArithmeticDriftError(
            f"customer {invoice.customer.customer_id}: total "
            f"{invoice.total_cents} != taxable + tax = {derived_total}"
        )

    for line in invoice.lines:
        if line.quantity * line.unit_cents != line.amount_cents:
            raise ArithmeticDriftError(
                f"customer {invoice.customer.customer_id}: line {line.sku} "
                f"amount {line.amount_cents} != {line.quantity} x {line.unit_cents}"
            )
