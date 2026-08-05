"""Source adapters: map raw export rows onto the shared LineItem shape.

Two sources feed the pipeline today:

- ``modern``  — the current billing platform's JSONL export
- ``legacy``  — the nightly CSV re-export from the old AS/400 system

Adapters own everything source-specific: column names, date formats,
and getting amounts into integer cents. Downstream stages never see a
source-shaped row.
"""

from .base import SourceAdapter
from .legacy import LegacyAdapter
from .modern import ModernAdapter

_ADAPTERS = {
    LegacyAdapter.name: LegacyAdapter,
    ModernAdapter.name: ModernAdapter,
}


def get_adapter(name):
    """Return an adapter instance for *name* ('modern' or 'legacy')."""
    try:
        return _ADAPTERS[name]()
    except KeyError:
        raise ValueError(f"unknown source adapter: {name!r}") from None


__all__ = ["LegacyAdapter", "ModernAdapter", "SourceAdapter", "get_adapter"]
