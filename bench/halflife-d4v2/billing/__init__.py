"""billing — a small invoice pipeline for quarterly customer billing.

Pipeline stages, in order:

1. io          — read fixture files (CSV, JSONL) into plain row dicts
2. adapters    — map source-specific row layouts onto LineItem records
3. validation  — reject rows that reference unknown customers or carry
                 unsupported currencies
4. normalize   — enforce the internal money invariant (integer cents)
5. periods     — restrict line items to the billing period
6. aggregate   — group line items per customer and per SKU
7. discounts   — tier-based volume discounts on the subtotal
8. tax         — regional tax on the discounted subtotal
9. invoice     — assemble the final Invoice with its total
10. render     — format invoices for display (the only dollar conversion)

All monetary amounts between stages 2 and 9 are integer cents.
"""

__version__ = "1.4.2"

__all__ = [
    "aggregate",
    "currency",
    "discounts",
    "errors",
    "invoice",
    "models",
    "normalize",
    "periods",
    "render",
    "tax",
    "validation",
]
