// @anchor/core — the runtime adapter seam.
//
// This is the load-bearing decision from coordination/proposals/anchor-as-a-tool.md:
// Anchor does NOT own orchestration. One interface keeps the role engine un-welded from
// any engine, so the same disciplines run on the Claude Agent SDK (primary target),
// Atomic's defineWorkflow, or Claude Code dynamic workflows — swap the adapter, keep the core.

import type { RoleSpec, RoleResult } from './types.ts';

export interface RuntimeAdapter {
  // Run one role to completion on the underlying substrate and return its result.
  spawnRole(spec: RoleSpec): Promise<RoleResult>;
}

// Deterministic in-memory adapter for tests and local dev — runs the engine end-to-end
// with no live model and no tokens. Tests inject behavior via `handler`; the default
// returns a generic READY result so the happy path runs out of the box.
export interface MockScenario {
  // Return a partial result for a given spec; the adapter fills sensible defaults.
  handler?: (spec: RoleSpec) => Partial<RoleResult>;
}

export class MockRuntimeAdapter implements RuntimeAdapter {
  scenario: MockScenario;

  constructor(scenario: MockScenario = {}) {
    this.scenario = scenario;
  }

  async spawnRole(spec: RoleSpec): Promise<RoleResult> {
    const partial = this.scenario.handler ? this.scenario.handler(spec) : {};
    return {
      role: spec.role,
      status: partial.status ?? 'READY',
      artifacts: partial.artifacts ?? [`coordination/${spec.role}/${spec.role}-out.md`],
      handoff: partial.handoff ?? { from: spec.role, model: spec.model },
      // Deterministic, non-zero usage so cost-aggregation paths are exercised in tests.
      usage: partial.usage ?? { input: 10, cache_creation: 100, cache_read: 200, output: 50 },
      escalation: partial.escalation,
    };
  }
}
