# PRD — csv-lite

A tiny, dependency-free TypeScript library for parsing and stringifying CSV text
(an RFC 4180 subset). Pure functions, no I/O. Built greenfield as an Anchor proof.

## Problem
Teams need a small, correct CSV round-trip helper without pulling a heavyweight
dependency. Correctness on the quoting/escaping edge cases is the whole point.

## Scope (this round)
Implement two pure functions in `src/index.ts` (and export them):

- `parse(text: string): string[][]`
  - Splits records on newlines (accept both `\n` and `\r\n`).
  - Splits fields on commas.
  - Supports double-quoted fields: a field wrapped in `"…"` may contain commas,
    newlines, and escaped quotes (`""` → a single `"`).
  - A trailing newline at the end of input does NOT produce an extra empty record.
  - Empty input (`""`) returns `[]`.

- `stringify(rows: string[][]): string`
  - Joins fields with commas and records with `\n`.
  - Quotes a field iff it contains a comma, a double-quote, or a newline; inside a
    quoted field, `"` is escaped as `""`.
  - `stringify([])` returns `""`.

Round-trip invariant: for any `rows` of plain or special-character strings,
`parse(stringify(rows))` deep-equals `rows`.

## Out of scope
- Streaming / async APIs, files, or stdin.
- Custom delimiters, headers/objects, type coercion, BOM handling.
- Configurable options of any kind. Keep the surface to the two functions above.

## Acceptance
These become tests (TDD):
1. `parse("a,b,c")` → `[["a","b","c"]]`
2. `parse("a,b\n c,d")` two records (and `\r\n` behaves the same as `\n`)
3. `parse('"a,b",c')` → `[["a,b","c"]]` (quoted comma stays in the field)
4. `parse('"she said ""hi"""')` → `[['she said "hi"']]` (escaped quotes)
5. `parse('"line1\nline2",x')` → one record, first field contains a newline
6. trailing newline produces no extra empty record; `parse("")` → `[]`
7. `stringify([["a","b"]])` → `"a,b"`; a field with a comma/quote/newline gets quoted
8. round-trip: `parse(stringify(rows))` deep-equals `rows` for special-character rows
