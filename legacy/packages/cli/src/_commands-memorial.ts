// @anchor/cli — `anchor memorial <list|ratios|prune|add>`: inspect and tend the memorial store.

import { MemorialStore } from '@anchor/core';
import { str } from './args.ts';
import type { CliContext, Flags } from './_commands-shared.ts';

// ── anchor memorial <list|ratios|prune> ──
export async function cmdMemorial(sub: string, flags: Flags, ctx: CliContext): Promise<{ code: number; data?: unknown }> {
  const store = new MemorialStore(ctx.makePersistence(str(flags, 'memorial')));
  if (sub === 'list') { const data = store.list(); ctx.stdout(JSON.stringify(data, null, 2)); return { code: 0, data }; }
  if (sub === 'ratios') {
    const data = store.ratios();
    ctx.stdout(data.map((r) => `${r.healthy ? '✓' : '✗'} ${r.id}  V=${r.v} C=${r.c}  ${r.status}`).join('\n') || '(no entries)');
    return { code: 0, data };
  }
  if (sub === 'prune') { const data = store.prune(ctx.now()); ctx.stdout(`stabilized: ${data.stabilized.join(', ') || '—'}\nretired: ${data.retired.join(', ') || '—'}`); return { code: 0, data }; }
  if (sub === 'add') {
    const id = str(flags, 'id'); const rule = str(flags, 'rule');
    if (!id || !rule) { ctx.stdout('error: memorial add requires --id and --rule (optional --trigger, --origin)'); return { code: 2 }; }
    try { store.add({ id, rule, trigger: str(flags, 'trigger') ?? '', origin: str(flags, 'origin') ?? 'operator' }); }
    catch (e) { ctx.stdout(`error: ${(e as Error).message}`); return { code: 2 }; }
    ctx.stdout(`added memorial "${id}"`);
    return { code: 0, data: store.list() };
  }
  ctx.stdout(`error: unknown memorial subcommand "${sub}" (use list|ratios|prune|add)`);
  return { code: 2 };
}
