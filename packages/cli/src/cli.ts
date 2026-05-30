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
Gates: structural (grilling/anti-scope) are advisory by default (--strict to block). The green-test gate
  runs the suite after the implementer and BLOCKS the round on red (no COMPLETE over failing tests); --no-test-gate to skip.
  --test-cmd "<cmd>" points the gate at a faster/incremental command (default `npm test`) — the biggest gate-latency lever.
  Remediation: on a failing gate the implementer re-runs with the findings as feedback and re-checks, up to --max-fix <n> times
  (default 2; 0 disables) — the cycle converges to green instead of stopping at the first red.
Adaptive structure: a high-risk directive (engine/ / architectural-decision / new pattern) earns a second independent
  reviewer pass — defense in depth for load-bearing changes; routine work is untouched. --no-risk-adapt to disable.
Within-feature parallelism: when the Architect declares file-disjoint parts (ANCHOR-UNIT [id]: <scope> lines), the engine
  fans out one sub-implementer per unit concurrently, then merges — decomposing a feature instead of one serial implementer.
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
