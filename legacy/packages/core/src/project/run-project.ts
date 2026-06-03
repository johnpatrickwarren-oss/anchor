// @anchor/core — project orchestration (the impure half of decomposition).
//
// `decompose` runs the Coordinator role to turn a project directive into declared features;
// `runProject` sequences the staged plan, delegating each stage's concurrent fan-out to a
// caller-supplied `runStage` (which owns worktrees/merge — git stays out of core). Together
// with project/index.ts (parse + staging) this is the Coordinator-in-the-tool.

import type { RuntimeAdapter } from '../runtime-adapter.ts';
import type { ModelManifest } from '../models.ts';
import type { WaveResult } from '../wave.ts';
import { resolveModel } from '../models.ts';
import { parseFeatures, planStages } from './index.ts';
import type { Feature, Stage } from './index.ts';

// Instruct the Coordinator to emit a machine-parseable plan. Only the ANCHOR-FEATURE lines are
// parsed (parseFeatures), so the model may narrate freely around them.
const FEATURE_FORMAT = [
  'You are the COORDINATOR. Do NOT write any code or files. Output ONLY a decomposition plan.',
  'Decompose this project into the SMALLEST set of independently-buildable FEATURES.',
  'Emit each feature as its OWN line beginning EXACTLY with `ANCHOR-FEATURE` — NOT inside a',
  'bulleted or numbered list, NOT in a code fence. Use EXACTLY this format:',
  '  ANCHOR-FEATURE [id]: <one-line scope — what to build>',
  '  ANCHOR-FEATURE [id] deps=[other-id, ...]: <scope>   (when it needs other features first)',
  'Rules: ids short + unique; deps list ONLY direct prerequisites; keep the graph acyclic;',
  'features at the same dependency level must be FILE-DISJOINT (they run concurrently).',
  'Emit the ANCHOR-FEATURE lines and nothing else of substance.',
].join('\n');

export interface DecomposeOptions {
  model?: string;
  manifest?: ModelManifest;
  contextRefs?: string[];
  /** Override the entire coordinator prompt (advanced/testing). */
  prompt?: string;
}

/**
 * Run the Coordinator role to decompose a project directive into features.
 *
 * Reads the parsed plan from the adapter's `handoff.features` (mirroring how Architect units
 * arrive via `handoff.units`); tolerates a raw-text handoff as a fallback. Throws if the
 * Coordinator produced nothing parseable — a decomposition with no features is a hard failure,
 * not an empty success.
 */
export async function decompose(
  adapter: RuntimeAdapter,
  directive: string,
  opts: DecomposeOptions = {},
): Promise<Feature[]> {
  const model = opts.model ?? resolveModel('coordinator', { manifest: opts.manifest });
  const prompt = opts.prompt ?? `${FEATURE_FORMAT}\n\n--- PROJECT ---\n${directive}`;
  const result = await adapter.spawnRole({ role: 'coordinator', model, contextRefs: opts.contextRefs ?? [], prompt });
  const raw = (result.handoff as Record<string, unknown>)?.features;
  let features: Feature[] = [];
  if (Array.isArray(raw)) features = raw as Feature[];
  else if (typeof raw === 'string') features = parseFeatures(raw);
  if (!features.length) throw new Error('coordinator produced no parseable ANCHOR-FEATURE plan');
  // Normalize shape defensively — the plan originates from a model.
  return features.map((f) => ({
    id: String(f.id),
    directive: String(f.directive),
    dependsOn: Array.isArray(f.dependsOn) ? f.dependsOn.map(String) : [],
  }));
}

export interface ProjectConfig {
  projectId: string;
}

export interface ProjectStageResult {
  stage: number;
  wave: WaveResult;
}

export interface ProjectResult {
  projectId: string;
  stages: ProjectStageResult[];
  /** Feature ids that never ran because an earlier stage did not fully complete. */
  skipped: string[];
  status: 'COMPLETE' | 'PARTIAL';
}

/**
 * Execute a decomposed project stage by stage.
 *
 * Each stage's mutually-independent features are handed to `runStage`, which fans them out
 * concurrently (the CLI does this via runWave on per-feature worktrees, then merges so the
 * NEXT stage sees this stage's code). Stages run in sequence, so a feature always sees its
 * prerequisites.
 *
 * Stop-on-stage-failure: if a stage is not fully COMPLETE, later stages are NOT launched
 * (they may depend on the failed work); their features are returned in `skipped` and the
 * project is PARTIAL. (v1 stops the whole project; per-branch continuation is future work.)
 */
export async function runProject(
  features: Feature[],
  runStage: (stage: Stage, index: number) => Promise<WaveResult>,
  config: ProjectConfig,
): Promise<ProjectResult> {
  const stages = planStages(features);
  const results: ProjectStageResult[] = [];
  for (let i = 0; i < stages.length; i++) {
    const wave = await runStage(stages[i], i);
    results.push({ stage: i, wave });
    if (wave.status !== 'COMPLETE') {
      const skipped = stages.slice(i + 1).flat().map((f) => f.id);
      return { projectId: config.projectId, stages: results, skipped, status: 'PARTIAL' };
    }
  }
  return { projectId: config.projectId, stages: results, skipped: [], status: 'COMPLETE' };
}
