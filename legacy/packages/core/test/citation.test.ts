import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCitations, parseCitationTable, gitCitationResolver } from '../src/index.ts';
import type { CitationResolver } from '../src/index.ts';

const SPEC = `# Topic 7 — demo

## Existing architectural surface (REVIEWER-ANCHOR — mandatory)

| Inherited file | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| \`src/foo.ts\` | \`abc1234\` | \`10-11\` | \`export const X = 1;\` | 2026-05-29 10:00 |

## Spec

body...`;

const goodResolver: CitationResolver = (file, sha, lines) =>
  file === 'src/foo.ts' && sha === 'abc1234' && lines === '10-11' ? 'export const X = 1;' : null;

test('parseCitationTable extracts data rows (skips header + separator)', () => {
  const rows = parseCitationTable(SPEC);
  assert.equal(rows.length, 1);
  assert.deepEqual({ file: rows[0].file, sha: rows[0].sha, lines: rows[0].lines, snippet: rows[0].snippet },
    { file: 'src/foo.ts', sha: 'abc1234', lines: '10-11', snippet: 'export const X = 1;' });
});

test('verbatim snippet that resolves passes', () => {
  const r = verifyCitations(SPEC, goodResolver);
  assert.equal(r.pass, true);
  assert.equal(r.findings.length, 0);
});

test('paraphrased snippet fails CRITICAL', () => {
  const r = verifyCitations(SPEC, () => 'export const X = 2;');
  assert.equal(r.pass, false);
  assert.equal(r.findings[0].severity, 'CRITICAL');
});

test('unresolvable citation (bad SHA) fails CRITICAL', () => {
  const r = verifyCitations(SPEC, () => null);
  assert.equal(r.pass, false);
  assert.match(r.findings[0].message, /does not resolve/);
});

test('placeholder row fails CRITICAL', () => {
  const spec = SPEC.replace('export const X = 1;', 'TBD');
  const r = verifyCitations(spec, goodResolver);
  assert.equal(r.pass, false);
});

test('explicit greenfield N/A row passes', () => {
  const spec = `## Existing architectural surface

| Inherited file | Pinned SHA | Lines opened | Verbatim snippet | Date+time opened |
|---|---|---|---|---|
| N/A — greenfield project; no inherited surface |

## Spec`;
  assert.equal(verifyCitations(spec, goodResolver).pass, true);
});

test('missing table is advisory (MINOR), not a hard fail', () => {
  const r = verifyCitations('# spec\n\n## Spec\n\nno citations here', goodResolver);
  assert.equal(r.pass, true);
  assert.equal(r.findings[0].severity, 'MINOR');
});

test('gitCitationResolver: null on bogus SHA; resolves a real committed file at HEAD', () => {
  const resolve = gitCitationResolver(process.cwd());
  assert.equal(resolve('packages/core/package.json', 'deadbeef0000', '1'), null);
  const head = resolve('packages/core/package.json', 'HEAD', '1');
  assert.equal(head, '{'); // line 1 of package.json
});
