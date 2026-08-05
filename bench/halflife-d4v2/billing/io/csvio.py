"""CSV reading with the small conventions our fixtures use.

Fixture CSVs may contain full-line comments starting with ``#`` (used
for provenance notes at the top of exports) and blank lines. Both are
stripped before the csv module sees the stream, so DictReader always
gets a clean header row first.
"""

import csv
import io

from ..errors import LoadError


def _strip_noise(handle):
    """Yield only meaningful CSV lines: no comments, no blank lines."""
    for raw in handle:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if line.lstrip().startswith("#"):
            continue
        yield line


def read_csv(path):
    """Read *path* as CSV and return a list of dicts keyed by header.

    Raises LoadError if the file is missing, empty, or has rows whose
    field count does not match the header.
    """
    try:
        with open(path, "r", encoding="utf-8", newline="") as handle:
            cleaned = io.StringIO("\n".join(_strip_noise(handle)))
    except OSError as exc:
        raise LoadError(path, f"cannot read: {exc.strerror}") from exc

    reader = csv.DictReader(cleaned)
    if reader.fieldnames is None:
        raise LoadError(path, "no header row")

    rows = []
    for lineno, row in enumerate(reader, start=2):
        if None in row or any(value is None for value in row.values()):
            raise LoadError(path, f"row {lineno}: field count does not match header")
        rows.append(dict(row))
    return rows
