"""File ingestion: raw fixture files to plain row dicts.

Nothing in this package interprets money or dates; that is the
adapters' job. These readers only handle framing (CSV dialect, JSONL
lines, comment stripping) and report structural problems as LoadError.
"""

from .csvio import read_csv
from .jsonl import read_jsonl
from .loader import load_customers, load_expected_totals, read_rows

__all__ = [
    "load_customers",
    "load_expected_totals",
    "read_csv",
    "read_jsonl",
    "read_rows",
]
