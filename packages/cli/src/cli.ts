#!/usr/bin/env node
// @anchor/cli — entrypoint. Thin: parse argv, dispatch to a command handler, set exit code.

import { parseArgs } from './args.ts';
import { defaultContext, cmdRoute, cmdRun, cmdMemorial, cmdWave } from './commands.ts';

const HELP = `anchor — run Anchor's disciplined role cycle on a commodity runtime

Usage:
  anchor run     [--directive <file> | --task "<text>" [--tier <t>]] [--cwd <dir>] [--round <id>] [--memorial <path>] [--maxTurns <n>] [--mock]
  anchor run     --resume [--state <path> | --round <id>] [--maxTurns <n>]  # continue a paused round (e.g. after a turn-budget pause)
  anchor wave    --plan <file> [--repo <dir> [--base <ref>]] [--concurrency <n>] [--memorial <path>]  # fan out independent cycles in parallel (--repo auto-creates a worktree+branch per item)
  anchor route   (--directive <file> | --task "<text>") [--tier <t>]      # dry-run: show classified tier + model routing
  anchor memorial <list|ratios|prune> [--memorial <path>]

Tiers: full | audit | solo | implementer-only | coordinator-only
Memorial: --memorial <path> injects + accrues disciplines; auto-pruned each run (--no-prune to skip).
  Injection is self-limiting: the most task-relevant rules inject (+ any live ones), capped at --max-rules (default 12; 0 = all).
--mock runs offline (no model/tokens). Real runs need ANTHROPIC_API_KEY + @anthropic-ai/claude-agent-sdk.`;

export async function main(argv: string[]): Promise<number> {
  const { _, flags } = parseArgs(argv);
  const cmd = _[0];
  const ctx = defaultContext();
  if (!cmd || flags.help) { ctx.stdout(HELP); return cmd ? 0 : 1; }
  switch (cmd) {
    case 'run': return (await cmdRun(flags, ctx)).code;
    case 'wave': return (await cmdWave(flags, ctx)).code;
    case 'route': return (await cmdRoute(flags, ctx)).code;
    case 'memorial': return (await cmdMemorial(_[1] ?? '', flags, ctx)).code;
    default: ctx.stdout(`unknown command "${cmd}"\n\n${HELP}`); return 1;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
