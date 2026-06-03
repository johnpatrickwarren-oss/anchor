// @anchor/core — anti-self-confirming-test gate (skill 13).
//
// The unified mutation-check: "would this test still pass if the production line it claims
// to verify were deleted or no-op'd?" If yes, the test is self-confirming — it asserts what
// it binds without testing the production behavior. This gate is deterministic: apply each
// mutation to the production code, run the tests, and require every mutation to be KILLED
// (tests must FAIL). A mutation the tests survive is a self-confirming-test finding.
//
// This is exactly the discipline the POC's Reviewer ran by hand on compareSemver (10 mutants,
// all killed). Here it's a callable gate.

import type { Finding, GateResult } from './types.ts';
import { gateResult } from './types.ts';

export interface Mutation {
  id: string;
  description: string; // e.g. "negate the §11.3 pre-release-lower comparison"
}

// Applies one mutation, runs the test suite, restores the source, and reports whether the
// tests still PASSED. testsPass === true means the mutation SURVIVED (bad). Default impl
// shells out (backup → mutate → run → restore); tests inject a deterministic runner.
export type MutationRunner = (mutation: Mutation) => { testsPass: boolean };

export function checkAntiSelfConfirming(mutations: Mutation[], run: MutationRunner): GateResult {
  const findings: Finding[] = [];

  if (mutations.length === 0) {
    findings.push({ severity: 'NIT', message: 'no mutations supplied — gate is vacuous; provide mutations targeting each AC\'s production line' });
    return gateResult(findings);
  }

  for (const m of mutations) {
    const { testsPass } = run(m);
    if (testsPass) {
      // Tests survived the mutation → at least one test is self-confirming.
      findings.push({ severity: 'CRITICAL', message: `mutation survived (tests still pass): ${m.description} — a test is self-confirming`, location: m.id });
    }
  }
  return gateResult(findings);
}
