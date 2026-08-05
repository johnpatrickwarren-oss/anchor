"""Adapter base class.

Concrete adapters implement ``adapt_row`` for a single source row; the
base class supplies iteration, blank-row skipping, and uniform error
context so a bad row always reports its source and line number.
"""

from ..errors import AdapterError


class SourceAdapter:
    """Base class for source adapters. Subclasses set ``name`` and
    ``required`` and implement ``adapt_row``."""

    #: Short source label, recorded on every LineItem this adapter emits.
    name = "base"

    #: Row keys that must be present and non-empty.
    required = ()

    def adapt(self, rows):
        """Map an iterable of row dicts onto a list of LineItems.

        Rows that are empty (all values blank) are skipped silently;
        rows that are present but unmappable raise AdapterError.
        """
        items = []
        for lineno, row in enumerate(rows, start=1):
            if not row or all(_blank(value) for value in row.values()):
                continue
            self._check_required(row, lineno)
            try:
                item = self.adapt_row(row)
            except AdapterError:
                raise
            except (KeyError, TypeError, ValueError) as exc:
                raise AdapterError(self.name, str(exc), lineno) from exc
            if item is not None:
                items.append(item)
        return items

    def adapt_row(self, row):
        """Map one row dict onto a LineItem (or None to skip)."""
        raise NotImplementedError

    def _check_required(self, row, lineno):
        missing = [key for key in self.required if _blank(row.get(key))]
        if missing:
            raise AdapterError(
                self.name, f"missing required field(s): {', '.join(missing)}", lineno
            )


def _blank(value):
    """True when a cell holds no usable content."""
    return value is None or (isinstance(value, str) and not value.strip())
