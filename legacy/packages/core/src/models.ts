// @anchor/core — per-role model resolution.
//
// Mirrors the manifest pattern shipped to Anchor's pipeline (scripts/models.json): roles
// reference capability CLASSES, concrete dated model IDs live in one manifest, so a new
// model release is a one-line edit. A per-role override seam is where the dynamic selectors
// (mu-model-select / impl-model-select) plug in later.

import type { ModelClass, Role } from './types.ts';

export interface ModelManifest {
  classes: Record<ModelClass, string>;
}

// Dated snapshots, not "-latest" aliases — reproducibility (Anchor determinism ethos).
export const DEFAULT_MANIFEST: ModelManifest = {
  classes: {
    reasoning: 'claude-opus-4-8',
    balanced: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5-20251001',
  },
};

// Static role -> class defaults (matches run-pipeline.sh's per-role map).
const ROLE_CLASS: Record<Role, ModelClass> = {
  architect: 'reasoning',
  reviewer: 'reasoning',
  coordinator: 'reasoning',
  implementer: 'balanced',
  memorial: 'cheap',
};

export interface ResolveModelOptions {
  manifest?: ModelManifest;
  // Per-role concrete-id override (the dynamic-selector seam). Wins over the class default.
  overrides?: Partial<Record<Role, string>>;
}

export function resolveModel(role: Role, opts: ResolveModelOptions = {}): string {
  const override = opts.overrides?.[role];
  if (override) return override;
  const manifest = opts.manifest ?? DEFAULT_MANIFEST;
  const cls = ROLE_CLASS[role];
  const model = manifest.classes[cls];
  if (!model) throw new Error(`no model for class "${cls}" (role ${role}) in manifest`);
  return model;
}
