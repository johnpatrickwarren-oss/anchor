// @anchor/core — citation / existing-architectural-surface gate.
//
// Ports verify-citations.sh + the Q-NN-SPEC template rule into code: every spec that
// cites inherited primitives must carry a citation table whose rows resolve at the pinned
// SHA and whose snippets are verbatim. Empty rows, placeholders ("TBD", "<...>"), or
// paraphrased snippets = FAIL. This converts the file-opened discipline (P3.3) from
// declarative ("did you open the file?") to mechanical ("does the cited text resolve?").

import type { Finding, GateResult } from './types.ts';
import { gateResult } from './types.ts';

// Resolves the actual file content at (file, sha, lineRange). Returns null if it can't
// (bad sha, missing file, out-of-range lines). Default impl shells out to git; tests inject.
export type CitationResolver = (file: string, sha: string, lineRange: string) => string | null;

const PLACEHOLDER = /\bTBD\b|<\.\.\.>|<[^>]*placeholder[^>]*>/i;

function norm(s: string): string {
  return s.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function stripCell(cell: string): string {
  return cell.trim().replace(/^`|`$/g, '').trim();
}

interface Row { file: string; sha: string; lines: string; snippet: string; raw: string; }

// Extract the citation table under the "Existing architectural surface" heading.
export function parseCitationTable(specText: string): Row[] {
  const lines = specText.split('\n');
  const start = lines.findIndex((l) => /existing architectural surface/i.test(l) && l.startsWith('#'));
  if (start === -1) return [];
  const rows: Row[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#')) break; // next section
    if (!l.trim().startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    // skip header + separator rows
    if (/inherited file/i.test(cells[0] || '') || /^-+$/.test((cells[0] || '').replace(/\s/g, ''))) continue;
    rows.push({ file: stripCell(cells[0] || ''), sha: stripCell(cells[1] || ''), lines: stripCell(cells[2] || ''), snippet: stripCell(cells[3] || ''), raw: l });
  }
  return rows;
}

export function verifyCitations(specText: string, resolve: CitationResolver): GateResult {
  const rows = parseCitationTable(specText);
  const findings: Finding[] = [];

  if (rows.length === 0) {
    // No table at all. Tolerated only if the spec cites no inherited primitives — the engine
    // can't know that here, so flag as MINOR (advisory) rather than block.
    findings.push({ severity: 'MINOR', message: 'no "Existing architectural surface" citation table found' });
    return gateResult(findings);
  }

  for (const row of rows) {
    // Explicit greenfield escape hatch from the template.
    if (/n\/a\s*[—-]\s*greenfield/i.test(row.file) || /greenfield/i.test(row.raw)) continue;

    if (PLACEHOLDER.test(row.raw) || !row.file || !row.sha || !row.lines || !row.snippet) {
      findings.push({ severity: 'CRITICAL', message: 'citation row is empty or contains a placeholder', location: `${row.file || '?'}` });
      continue;
    }
    const actual = resolve(row.file, row.sha, row.lines);
    if (actual === null) {
      findings.push({ severity: 'CRITICAL', message: `citation does not resolve at SHA ${row.sha}`, location: `${row.file}:${row.lines}` });
      continue;
    }
    if (!norm(actual).includes(norm(row.snippet))) {
      findings.push({ severity: 'CRITICAL', message: 'snippet is not verbatim at the cited lines (paraphrased or wrong lines)', location: `${row.file}:${row.lines}` });
    }
  }
  return gateResult(findings);
}
