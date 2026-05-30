/**
 * csv-lite test suite — one test per acceptance criterion from the PRD.
 *
 * Every assertion is written so it FAILS if the production line it exercises
 * is absent or broken (no self-confirming tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from '../src/index.ts';

// ── AC-1: simple single-record parse ────────────────────────────────────────
test('AC-1: parse("a,b,c") → [["a","b","c"]]', () => {
  assert.deepEqual(parse('a,b,c'), [['a', 'b', 'c']]);
});

// ── AC-2: two records — \n and \r\n both split records ──────────────────────
test('AC-2a: \\n splits into two records', () => {
  // The space before "c" is a significant leading space (RFC 4180 — no trimming).
  assert.deepEqual(parse('a,b\n c,d'), [['a', 'b'], [' c', 'd']]);
});

test('AC-2b: \\r\\n splits into two records identically to \\n', () => {
  assert.deepEqual(parse('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
});

// ── AC-3: quoted field containing a comma ───────────────────────────────────
test('AC-3: quoted comma stays inside the field', () => {
  assert.deepEqual(parse('"a,b",c'), [['a,b', 'c']]);
});

// ── AC-4: escaped double-quotes inside a quoted field ───────────────────────
test('AC-4: "" inside a quoted field becomes a single "', () => {
  assert.deepEqual(parse('"she said ""hi"""'), [['she said "hi"']]);
});

// ── AC-5: quoted field containing a newline → single record ─────────────────
test('AC-5: newline inside quoted field does not split records', () => {
  const result = parse('"line1\nline2",x');
  assert.equal(result.length, 1, 'must be exactly one record');
  assert.equal(result[0][0], 'line1\nline2', 'first field must contain the embedded newline');
  assert.equal(result[0][1], 'x', 'second field must be x');
});

// ── AC-6: trailing newline and empty input ───────────────────────────────────
test('AC-6a: trailing \\n does not produce an extra empty record', () => {
  assert.deepEqual(parse('a,b\n'), [['a', 'b']]);
});

test('AC-6b: trailing \\r\\n does not produce an extra empty record', () => {
  assert.deepEqual(parse('a,b\r\n'), [['a', 'b']]);
});

test('AC-6c: empty string returns []', () => {
  assert.deepEqual(parse(''), []);
});

// ── AC-7: stringify basics and quoting ──────────────────────────────────────
test('AC-7a: stringify plain fields uses commas and no quotes', () => {
  assert.equal(stringify([['a', 'b']]), 'a,b');
});

test('AC-7b: stringify quotes a field that contains a comma', () => {
  const out = stringify([['a,b', 'c']]);
  assert.equal(out, '"a,b",c');
});

test('AC-7c: stringify quotes a field that contains a double-quote (and escapes it)', () => {
  const out = stringify([['say "hi"']]);
  assert.equal(out, '"say ""hi"""');
});

test('AC-7d: stringify quotes a field that contains a newline', () => {
  const out = stringify([['line1\nline2']]);
  assert.equal(out, '"line1\nline2"');
});

test('AC-7e: stringify([]) returns empty string', () => {
  assert.equal(stringify([]), '');
});

// ── AC-8: round-trip invariant ───────────────────────────────────────────────
test('AC-8a: round-trip plain rows', () => {
  const rows = [['a', 'b', 'c'], ['d', 'e', 'f']];
  assert.deepEqual(parse(stringify(rows)), rows);
});

test('AC-8b: round-trip rows with commas, quotes, and newlines in fields', () => {
  const rows = [
    ['with,comma', 'with"quote', 'with\nnewline'],
    ['also "tricky"', 'a,b,c', 'plain'],
  ];
  assert.deepEqual(parse(stringify(rows)), rows);
});

test('AC-8c: round-trip single-field rows with all special characters combined', () => {
  const rows = [['she said "hello, world"\nbye']];
  assert.deepEqual(parse(stringify(rows)), rows);
});
