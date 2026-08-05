"""Rendering: invoices to text.

This is the pipeline's exit to display units. Every cents→dollars
conversion in the system funnels through billing.currency here (or in
the report driver's comparison, which uses the same function).
"""

from . import currency

_WIDTH = 72
_RULE = "-" * _WIDTH


def summary_line(invoice):
    """One-line per-customer summary for the report listing."""
    customer = invoice.customer
    return (
        f"customer {customer.customer_id:>5}  {customer.name:<26}"
        f"total {currency.format_cents(invoice.total_cents):>12}"
    )


def render_invoice(invoice):
    """Render a full text invoice body, one string, trailing newline."""
    customer = invoice.customer
    out = []
    out.append(_RULE)
    out.append(f"INVOICE  {customer.name}  (account {customer.customer_id})")
    out.append(f"Period: {invoice.period_label}   Region: {customer.region}   "
               f"Tier: {customer.tier}")
    out.append(_RULE)
    out.append(f"{'SKU':<12}{'DESCRIPTION':<32}{'QTY':>5}{'AMOUNT':>14}")
    for line in invoice.lines:
        out.append(
            f"{line.sku:<12}{line.description[:31]:<32}{line.quantity:>5}"
            f"{currency.format_cents(line.amount_cents):>14}"
        )
    out.append(_RULE)
    out.append(_money_row("Subtotal", invoice.subtotal_cents))
    if invoice.discount_cents:
        label = f"Discount ({_pct(invoice.discount_rate)})"
        out.append(_money_row(label, -invoice.discount_cents))
    out.append(_money_row(f"Tax ({_pct(invoice.tax_rate)})", invoice.tax_cents))
    out.append(_money_row("TOTAL DUE", invoice.total_cents))
    out.append(_RULE)
    return "\n".join(out) + "\n"


def _money_row(label, cents):
    """Right-aligned money row; negative amounts render in parentheses."""
    if cents < 0:
        text = f"({currency.format_cents(-cents)})"
    else:
        text = currency.format_cents(cents)
    return f"{label:<49}{text:>23}"


def _pct(rate):
    """Format a decimal rate string as a percentage, e.g. 0.05 -> 5%."""
    return format(float(rate) * 100, "g") + "%"
