// @anchor/core — anti-scope gate (skill 06).
//
// Two checks:
//   checkAntiScope        — STRUCTURAL: the spec carries an explicit anti-scope section.
//   checkAntiScopeViolation — PATH-BASED: no written file matches a declared anti-scope
//                              pattern (substring, or a simple `*` glob). The semantic
//                              "did the work violate a declared clause" still needs a
//                              cold-eye Reviewer; this catches the mechanical case.

import type { Finding, GateResult } from './types.ts';
import { gateResult } from './types.ts';

export function checkAntiScope(text: string): GateResult {
  const hasSection = /(^|\n)#{1,6}\s*anti-?scope/i.test(text) || /\banti-?scope\b/i.test(text);
  const findings: Finding[] = [];
  if (!hasSection) findings.push({ severity: 'CRITICAL', message: 'no anti-scope section — the spec must name what is explicitly NOT in scope (skill 06)' });
  return gateResult(findings);
}

function matches(pattern: string, file: string): boolean {
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(file) || re.test(file.split('/').pop() ?? file);
  }
  return file.includes(pattern);
}

export function checkAntiScopeViolation(antiScopePatterns: string[], writtenFiles: string[]): GateResult {
  const findings: Finding[] = [];
  for (const file of writtenFiles) {
    for (const pattern of antiScopePatterns) {
      if (matches(pattern, file)) {
        findings.push({ severity: 'CRITICAL', message: `wrote a file inside an anti-scoped area (pattern: ${pattern})`, location: file });
      }
    }
  }
  return gateResult(findings);
}
