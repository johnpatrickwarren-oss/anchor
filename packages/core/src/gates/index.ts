// @anchor/core — discipline gates (Phase 3): public surface + engine wiring + default impls.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { GateOutcome, EngineDeps } from '../role-engine.ts';
import type { Role, RoleResult, RoundConfig } from '../types.ts';
import type { CitationResolver } from './citation.ts';
import type { Mutation, MutationRunner } from './anti-self-confirming.ts';
import { verifyCitations } from './citation.ts';
import { checkAntiSelfConfirming } from './anti-self-confirming.ts';
import { checkGrillingEmitted } from './grilling.ts';
import { checkAntiScope, checkAntiScopeViolation } from './anti-scope.ts';
import { toGateOutcome } from './types.ts';

export type { Finding, Severity, GateResult } from './types.ts';
export { gateResult, toGateOutcome } from './types.ts';
export { verifyCitations, parseCitationTable } from './citation.ts';
export type { CitationResolver } from './citation.ts';
export { checkAntiSelfConfirming } from './anti-self-confirming.ts';
export type { Mutation, MutationRunner } from './anti-self-confirming.ts';
export { checkGrillingEmitted } from './grilling.ts';
export { checkAntiScope, checkAntiScopeViolation } from './anti-scope.ts';

type EngineGate = NonNullable<EngineDeps['gates']>;

// A gate can accrue its discipline's V/C to the memorial (closing the learning loop).
// MemorialStore satisfies this structurally.
export interface MemorialAccrual { recordConfirmation(id: string, date?: string): void; recordViolation(id: string, date?: string): void; }

// Shared spec reader: prefer the canonical config.specPath (deterministic — set by the
// engine, which also instructs the Architect to write there); fall back to guessing the
// first .md artifact whose path mentions "spec".
function readSpec(r: RoleResult, config?: RoundConfig): string | null {
  const path = config?.specPath ?? r.artifacts.find((p) => /spec/i.test(p) && p.endsWith('.md'));
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

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
  return (result: RoleResult, config: RoundConfig) => {
    if (result.role !== 'architect' && result.role !== 'implementer') return { pass: true, findings: [] };
    const text = specTextFor ? specTextFor(result) : readSpec(result, config);
    if (text === null) return { pass: true, findings: [] }; // nothing to check
    return toGateOutcome(verifyCitations(text, resolve));
  };
}

// Engine-hook factory: the Architect's spec must carry a pre-emit grilling pass (structural).
// blocking=true (default) halts the run on failure; blocking=false surfaces findings as
// non-blocking warnings (the recommended default in `anchor run`, since this gate is heuristic).
export function grillingGate(specTextFor?: (r: RoleResult) => string | null, blocking = true, accrual?: { sink: MemorialAccrual; memorialId: string }): EngineGate {
  return (result: RoleResult, config: RoundConfig) => {
    if (result.role !== 'architect') return { pass: true, findings: [] };
    const text = specTextFor ? specTextFor(result) : readSpec(result, config);
    if (text === null) return { pass: true, findings: [] };
    const res = checkGrillingEmitted(text);
    if (accrual) {
      if (res.pass) accrual.sink.recordConfirmation(accrual.memorialId, config.runDate);
      else accrual.sink.recordViolation(accrual.memorialId, config.runDate);
    }
    const o = toGateOutcome(res);
    return blocking ? o : { pass: true, findings: o.findings }; // advisory keeps findings, accrues either way
  };
}

// Engine-hook factory: the Architect's spec must carry an anti-scope section (structural),
// and (optionally) no written file may fall inside a declared anti-scope pattern.
// blocking=false surfaces findings as warnings instead of halting.
export function antiScopeGate(opts: { specTextFor?: (r: RoleResult) => string | null; patternsFor?: (r: RoleResult) => string[]; blocking?: boolean; accrual?: { sink: MemorialAccrual; memorialId: string } } = {}): EngineGate {
  return (result: RoleResult, config: RoundConfig) => {
    const findings: string[] = [];
    if (result.role === 'architect') {
      const text = opts.specTextFor ? opts.specTextFor(result) : readSpec(result, config);
      if (text !== null) {
        const res = checkAntiScope(text);
        if (opts.accrual) {
          if (res.pass) opts.accrual.sink.recordConfirmation(opts.accrual.memorialId, config.runDate);
          else opts.accrual.sink.recordViolation(opts.accrual.memorialId, config.runDate);
        }
        const o = toGateOutcome(res); if (o.findings) findings.push(...o.findings);
      }
    }
    if (opts.patternsFor) {
      const o = toGateOutcome(checkAntiScopeViolation(opts.patternsFor(result), result.artifacts));
      if (o.findings) findings.push(...o.findings);
    }
    return { pass: opts.blocking === false ? true : findings.length === 0, findings };
  };
}

// Engine-hook factory: run the anti-self-confirming mutation gate (typically on the Implementer).
export function antiSelfConfirmingGate(mutationsFor: (r: RoleResult) => Mutation[], run: MutationRunner): EngineGate {
  return (result: RoleResult) => {
    if (result.role !== 'implementer') return { pass: true, findings: [] };
    return toGateOutcome(checkAntiSelfConfirming(mutationsFor(result), run));
  };
}

// Engine-hook factory: the test suite must be GREEN. Runs `run()` (the project's test
// command) after the code-producing roles and BLOCKS the round on failure — a deterministic
// "no COMPLETE over red tests" gate, the one check that shouldn't be left to a model's
// self-reported status. Blocking by design (a red suite is a hard fact, not a heuristic).
export function testGate(opts: {
  run: () => boolean | Promise<boolean>;
  roles?: Role[]; // roles after which to run the suite (default: implementer + reviewer)
  accrual?: { sink: MemorialAccrual; memorialId: string };
}): EngineGate {
  const roles = new Set<Role>(opts.roles ?? ['implementer', 'reviewer']);
  return async (result: RoleResult, config: RoundConfig): Promise<GateOutcome> => {
    if (!roles.has(result.role)) return { pass: true, findings: [] };
    const green = await opts.run();
    if (opts.accrual) {
      if (green) opts.accrual.sink.recordConfirmation(opts.accrual.memorialId, config.runDate);
      else opts.accrual.sink.recordViolation(opts.accrual.memorialId, config.runDate);
    }
    return green
      ? { pass: true, findings: [] }
      : { pass: false, findings: [`test suite is RED after ${result.role} — round blocked (a green suite is required to complete)`] };
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

// Build a test runner for testGate: runs the project's test command in `cwd` and returns
// true iff it exits 0. Default command is `npm test` (which, in Cairn-style repos, runs the
// full clean build + suite via pretest). Any non-zero exit (compile error or test failure)
// is RED.
export function npmTestRunner(cwd: string, command: string[] = ['npm', 'test']): () => boolean {
  return () => {
    try {
      execFileSync(command[0], command.slice(1), { cwd, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
}
