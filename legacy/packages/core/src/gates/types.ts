// @anchor/core — discipline gate types.
// A gate is an executable discipline check (Phase 3): it turns an Anchor discipline from
// a prose reminder into a function the engine calls after a role emits, before forwarding.

import type { GateOutcome } from '../role-engine.ts';

export type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT';

export interface Finding {
  severity: Severity;
  message: string;
  location?: string;
}

export interface GateResult {
  pass: boolean;
  findings: Finding[];
}

// CRITICAL/MAJOR findings fail the gate; MINOR/NIT are advisory.
export function gateResult(findings: Finding[]): GateResult {
  const pass = !findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR');
  return { pass, findings };
}

// Adapt a GateResult to the engine's GateOutcome hook shape.
export function toGateOutcome(r: GateResult): GateOutcome {
  return { pass: r.pass, findings: r.findings.map((f) => `[${f.severity}] ${f.message}${f.location ? ` (${f.location})` : ''}`) };
}
