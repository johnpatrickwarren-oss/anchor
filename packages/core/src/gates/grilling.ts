// @anchor/core — pre-emit grilling gate (skill 01), STRUCTURAL form.
//
// Pre-emit grilling is model-driven judgment, so a code gate can't score the grilling —
// it can only verify the role EMITTED one. This checks the artifact carries a three-bucket
// grilling pass (CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE) or an explicit grilling heading.
// Honest about its own weakness: presence ≠ quality. It catches "no grilling at all", which
// is the common omission; a cold-eye Reviewer still judges whether the grilling was real.

import type { Finding, GateResult } from './types.ts';
import { gateResult } from './types.ts';

const CRITICAL = /\bCRITICAL\b/;
const LIKELY = /LIKELY[-\s]SURFACES?/i;
const PREEMPTABLE = /PRE-?EMPTABLE/i;
const HEADING = /pre-emit grilling|grilling pass/i;

export function checkGrillingEmitted(text: string): GateResult {
  const hasBuckets = CRITICAL.test(text) && LIKELY.test(text) && PREEMPTABLE.test(text);
  const findings: Finding[] = [];
  if (!HEADING.test(text) && !hasBuckets) {
    findings.push({ severity: 'CRITICAL', message: 'no pre-emit grilling output found (expected a grilling pass with CRITICAL / LIKELY-SURFACES / PRE-EMPTABLE buckets)' });
  }
  return gateResult(findings);
}
