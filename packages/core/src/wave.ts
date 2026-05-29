// @anchor/core — wave executor (fan-out across INDEPENDENT cycles).
//
// The role cycle (architect→implementer→reviewer→memorial) is a data-dependency chain and
// stays sequential. But independent FEATURES have no dependency between them, so their
// cycles can run concurrently — this is the throughput lever. A "wave" is a set of such
// independent items; runWave fans them out with bounded concurrency and aggregates the
// results in deterministic (input) order.
//
// Determinism: the STRUCTURE is deterministic (which items, which roles, result order) even
// though items run concurrently — no Date.now()/Math.random(); results are indexed by input
// position, not completion order. Each item gets its OWN EngineDeps (its own adapter/cwd),
// so concurrent items must NOT share a working tree — that isolation is the caller's job
// (e.g. one git worktree per item); the engine only orchestrates.

import type { RunResult, Tier } from './types.ts';
import type { EngineDeps } from './role-engine.ts';
import { runRound } from './role-engine.ts';
import { runRoundFromDirective } from './routing/index.ts';

export interface WaveItem {
  /** Stable id → becomes the round id; also the aggregation key. */
  id: string;
  /** Either a directive (self-routes its tier) … */
  directive?: string;
  /** … or a task + tier for a fixed cycle. */
  task?: string;
  tier?: Tier;
  specPath?: string;
  /** Isolation hint for the runtime (e.g. a per-item worktree). The engine ignores it;
   *  the caller's depsFor uses it to build an isolated adapter. */
  cwd?: string;
}

export interface WaveRoundResult {
  itemId: string;
  result: RunResult;
}

export interface WaveResult {
  waveId: string;
  /** One entry per item, in INPUT order (not completion order) — replay-stable. */
  rounds: WaveRoundResult[];
  /** COMPLETE iff every round completed; otherwise PARTIAL (some paused/blocked). */
  status: 'COMPLETE' | 'PARTIAL';
}

export interface WaveConfig {
  waveId: string;
  runDate: string;
  /** Max items running at once. Default 3 — bounds cost/load on the model + host. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 3;

/** Run each independent item through its own Anchor cycle, fanned out with bounded
 *  concurrency. `depsFor` builds the per-item EngineDeps (its own adapter/cwd/memorial). */
export async function runWave(
  items: WaveItem[],
  depsFor: (item: WaveItem) => EngineDeps,
  config: WaveConfig,
): Promise<WaveResult> {
  const rounds: WaveRoundResult[] = new Array(items.length);
  const concurrency = Math.max(1, config.concurrency ?? DEFAULT_CONCURRENCY);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      const item = items[idx];
      const deps = depsFor(item);
      const result = item.directive !== undefined
        ? await runRoundFromDirective(item.directive, deps, {
            roundId: item.id, runDate: config.runDate, tierOverride: item.tier, specPath: item.specPath,
          })
        : await runRound(
            { roundId: item.id, tier: item.tier ?? 'audit', task: item.task ?? '', runDate: config.runDate, specPath: item.specPath },
            deps,
          );
      rounds[idx] = { itemId: item.id, result };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  const status: WaveResult['status'] =
    rounds.every((r) => r.result.status === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL';
  return { waveId: config.waveId, rounds, status };
}
