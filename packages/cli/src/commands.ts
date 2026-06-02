// @anchor/cli — command handlers. Dependency-injected (adapter, persistence, clock, stdout)
// so every command is unit-testable offline; cli.ts wires the real defaults.
//
// This file is a thin FACADE: the handlers live in cohesive `_commands-*.ts` siblings (split by
// command group, with shared infrastructure in _commands-shared). The public surface — every name
// consumers import from './commands' — is re-exported VERBATIM here, so import sites are unchanged.

export type { CliContext } from './_commands-shared.ts';
export { defaultContext } from './_commands-shared.ts';
export { renderRoute, renderRun, renderWave, renderProject, cmdRoute } from './_commands-render.ts';
export { cmdInit, cmdCalibrate } from './_commands-scaffold.ts';
export { cmdRun } from './_commands-run.ts';
export { cmdWave } from './_commands-wave.ts';
export { cmdProject } from './_commands-project.ts';
export { cmdMemorial } from './_commands-memorial.ts';
