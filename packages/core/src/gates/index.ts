// @anchor/core — discipline gates (Phase 3): public surface + engine wiring + default impls.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { GateOutcome, EngineDeps } from '../role-engine.ts';
import type { RoleResult, RoundConfig } from '../types.ts';
import type { CitationResolver } from './citation.ts';
import type { Mutation, MutationRunner } from './anti-self-confirming.ts';
import { verifyCitations } from './citation.ts';
import { checkAntiSelfConfirming } from './anti-self-confirming.ts';
import { toGateOutcome } from './types.ts';

export type { Finding, Severity, GateResult } from './types.ts';
export { gateResult, toGateOutcome } from './types.ts';
export { verifyCitations, parseCitationTable } from './citation.ts';
export type { CitationResolver } from './citation.ts';
export { checkAntiSelfConfirming } from './anti-self-confirming.ts';
export type { Mutation, MutationRunner } from './anti-self-confirming.ts';

type EngineGate = NonNullable<EngineDeps['gates']>;

// Combine several engine gates into one hook: pass = all pass; findings concatenated.
export function composeGates(...gates: EngineGate[]): EngineGate {
  return async (result: RoleResult, config: RoundConfig): Promise<GateOutcome> => {
    const findings: string[] = [];
    let pass = true;
    for (const g of gates) {
      const o = await g(result, config);
      if (!o.pass) pass = false;
      if (o.findings) findings.push(...o.findings);
    }
    return { pass, findings };
  };
}

// Engine-hook factory: read the spec the role wrote and run the citation gate against it.
export function citationGate(resolve: CitationResolver, specTextFor?: (r: RoleResult) => string | null): EngineGate {
  const readSpec = specTextFor ?? ((r: RoleResult) => {
    const spec = r.artifacts.find((p) => /spec/i.test(p) && p.endsWith('.md'));
    if (!spec) return null;
    try { return readFileSync(spec, 'utf8'); } catch { return null; }
  });
  return (result: RoleResult) => {
    if (result.role !== 'architect' && result.role !== 'implementer') return { pass: true, findings: [] };
    const text = readSpec(result);
    if (text === null) return { pass: true, findings: [] }; // nothing to check
    return toGateOutcome(verifyCitations(text, resolve));
  };
}

// Engine-hook factory: run the anti-self-confirming mutation gate (typically on the Implementer).
export function antiSelfConfirmingGate(mutationsFor: (r: RoleResult) => Mutation[], run: MutationRunner): EngineGate {
  return (result: RoleResult) => {
    if (result.role !== 'implementer') return { pass: true, findings: [] };
    return toGateOutcome(checkAntiSelfConfirming(mutationsFor(result), run));
  };
}

// ── Default impls (real, environment-specific; unit tests inject mocks instead) ──────────

// Resolve cited content via git at a pinned SHA. Returns null on any failure.
export function gitCitationResolver(cwd: string = process.cwd()): CitationResolver {
  return (file, sha, lineRange) => {
    try {
      const content = execFileSync('git', ['show', `${sha}:${file}`], { cwd, encoding: 'utf8' });
      const lines = content.split('\n');
      const m = lineRange.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (from < 1 || to > lines.length || from > to) return null;
      return lines.slice(from - 1, to).join('\n');
    } catch {
      return null;
    }
  };
}

// Build a MutationRunner that, per mutation id, applies a source transform, runs the test
// command, and restores the file. testsPass = (test command exited 0). mutators maps a
// mutation id -> a function that transforms the original source into the mutated source.
export function makeFileMutationRunner(opts: {
  file: string;
  testCommand: string[]; // e.g. ['node', '--test', 'test/x.test.ts']
  mutators: Record<string, (src: string) => string>;
  cwd?: string;
}): MutationRunner {
  const cwd = opts.cwd ?? process.cwd();
  return (mutation: Mutation) => {
    const original = readFileSync(opts.file, 'utf8');
    const mutate = opts.mutators[mutation.id];
    if (!mutate) throw new Error(`no mutator registered for mutation id "${mutation.id}"`);
    try {
      writeFileSync(opts.file, mutate(original));
      try {
        execFileSync(opts.testCommand[0], opts.testCommand.slice(1), { cwd, stdio: 'ignore' });
        return { testsPass: true }; // exit 0 = tests passed = mutation SURVIVED (bad)
      } catch {
        return { testsPass: false }; // non-zero = tests failed = mutation KILLED (good)
      }
    } finally {
      writeFileSync(opts.file, original); // always restore
    }
  };
}
