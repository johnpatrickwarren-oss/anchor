"""JSONL reading for the modern billing export.

One JSON object per line. Blank lines and full-line ``//`` comments are
tolerated (the export tool emits a comment banner at the top of each
file). Anything else that fails to parse is a LoadError with the line
number, because a half-ingested export is worse than a loud failure.
"""

import json

from ..errors import LoadError


def read_jsonl(path):
    """Read *path* as JSONL and return a list of dicts, in file order."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw_lines = handle.readlines()
    except OSError as exc:
        raise LoadError(path, f"cannot read: {exc.strerror}") from exc

    rows = []
    for lineno, raw in enumerate(raw_lines, start=1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise LoadError(path, f"line {lineno}: invalid JSON ({exc.msg})") from exc
        if not isinstance(obj, dict):
            raise LoadError(path, f"line {lineno}: expected an object, got {type(obj).__name__}")
        rows.append(obj)
    return rows
