// @anchor/runtime-agent-sdk — RuntimeAdapter backed by the Claude Agent SDK.
//
// This is the first REAL adapter (the others shipped only a mock). It runs one Anchor role
// as an Agent SDK `query()` — an agentic loop with file/bash tools — and maps the result
// back to @anchor/core's RoleResult, including honest per-category token usage.
//
// Design: `query` is dependency-INJECTED, so the full adapter is unit-tested with a fake
// stream (no SDK install, no API key). On the live path it dynamically imports the real
// `@anthropic-ai/claude-agent-sdk`. See README for the (operator-run) live verification.

import type { RuntimeAdapter, RoleSpec, RoleResult, Role, Usage, RoleStatus, Escalation } from '@anchor/core';
import type { QueryFn, SdkQueryOptions, SdkMessage, SdkUsage, SdkAssistantMessage, SdkResultMessage } from './sdk-types.ts';

export interface AgentSdkAdapterOptions {
  queryFn?: QueryFn; // inject for tests; default = real SDK query (dynamic import)
  cwd?: string;
  permissionMode?: SdkQueryOptions['permissionMode']; // default 'acceptEdits' (autonomous role work)
  maxTurns?: number;
  systemPromptFor?: (role: Role) => string;
  // Transient-error resilience: retry the SDK call on retryable failures (529 Overloaded,
  // socket close, ECONNRESET, …) with exponential backoff. Default 3 retries (4 attempts).
  maxRetries?: number;
  retryBaseDelayMs?: number; // default 500; delay = base × 2^attempt, capped at 8s
  sleep?: (ms: number) => Promise<void>; // injectable for tests (default = real timer)
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export function mapUsage(u: SdkUsage | undefined): Usage {
  return {
    input: u?.input_tokens ?? 0,
    cache_creation: u?.cache_creation_input_tokens ?? 0,
    cache_read: u?.cache_read_input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Collect file paths the agent wrote/edited, from tool_use blocks.
export function extractArtifacts(messages: SdkMessage[]): string[] {
  const paths = new Set<string>();
  for (const m of messages) {
    if (m.type !== 'assistant') continue;
    const content = (m as SdkAssistantMessage).message?.content ?? [];
    for (const block of content) {
      if (block.type === 'tool_use' && WRITE_TOOLS.has((block as { name: string }).name)) {
        const fp = (block as { input?: { file_path?: string } }).input?.file_path;
        if (typeof fp === 'string') paths.add(fp);
      }
    }
  }
  return [...paths];
}

// Role status from the agent's final text, using Anchor's NEXT-ROLE signalling conventions.
// Anchored to DELIBERATE line-leading status markers (optionally "STATUS:") so that prose
// mentions — e.g. "no HALT/DIAGNOSTIC was needed" — are NOT mistaken for a halt. (A naive
// bare-keyword match false-positived a successful Implementer in live testing.)
const ESCALATE_RE = /^[>\s*\-]*(?:STATUS:\s*)?ESCALATE\b[:\s\-]*(.*)$/im;
const BLOCK_RE = /^[>\s*\-]*(?:STATUS:\s*)?(?:HALT|BLOCKED|DIAGNOSTIC)\b/im;

export function detectStatus(finalText: string, role: Role): { status: RoleStatus; escalation?: Escalation } {
  const esc = finalText.match(ESCALATE_RE);
  if (esc) {
    const q = (esc[1] || '').trim() || 'operator decision required';
    return { status: 'ESCALATE', escalation: { question: q.slice(0, 500), raisedBy: role } };
  }
  if (BLOCK_RE.test(finalText)) return { status: 'BLOCKED' };
  return { status: 'READY' };
}

// Deterministic status CONTRACT: the adapter asks each role to end with an explicit
// `ANCHOR-STATUS: <READY|ESCALATE|BLOCKED>` line (see buildPrompt). Parsing that token is
// unambiguous — unlike prose-sniffing. Falls back to the (anchored) heuristic only when the
// agent didn't emit the sentinel, so older prompts / non-compliant agents still degrade gracefully.
const CONTRACT_RE = /^ANCHOR-STATUS:\s*(READY|ESCALATE|BLOCKED)\b/gim;
const CONTRACT_ESCALATE_RE = /^ANCHOR-ESCALATE:\s*(.+)$/im;

export function parseStatusContract(finalText: string, role: Role): { status: RoleStatus; escalation?: Escalation } {
  const matches = [...finalText.matchAll(CONTRACT_RE)];
  if (matches.length === 0) return detectStatus(finalText, role); // fallback to heuristic
  const status = matches[matches.length - 1][1].toUpperCase() as RoleStatus; // last wins
  if (status === 'ESCALATE') {
    const q = (finalText.match(CONTRACT_ESCALATE_RE)?.[1] || '').trim() || 'operator decision required';
    return { status, escalation: { question: q.slice(0, 500), raisedBy: role } };
  }
  return { status };
}

export function lastAssistantText(messages: SdkMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== 'assistant') continue;
    const text = ((m as SdkAssistantMessage).message?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');
    if (text) return text;
  }
  return '';
}

export function buildQueryOptions(spec: RoleSpec, opts: AgentSdkAdapterOptions): SdkQueryOptions {
  return {
    systemPrompt: opts.systemPromptFor?.(spec.role) ?? `You are the ${spec.role.toUpperCase()} in an Anchor methodology cycle. Stay strictly within your role.`,
    model: spec.model,
    allowedTools: spec.tools,
    cwd: opts.cwd,
    permissionMode: opts.permissionMode ?? 'acceptEdits',
    maxTurns: opts.maxTurns,
  };
}

const STATUS_CONTRACT =
  '\n\nWhen finished, end your final message with a status line:\n' +
  'ANCHOR-STATUS: READY   (use ESCALATE if an operator decision is required, or BLOCKED if you must halt)\n' +
  'If ESCALATE, add a second line — ANCHOR-ESCALATE: <one-line bounded question>.';

export function buildPrompt(spec: RoleSpec): string {
  const refs = spec.contextRefs.length ? `\n\nContext files (read as needed): ${spec.contextRefs.join(', ')}` : '';
  return `${spec.prompt}${refs}${STATUS_CONTRACT}`;
}

// ── The adapter ──────────────────────────────────────────────────────────────

export class AgentSdkAdapter implements RuntimeAdapter {
  opts: AgentSdkAdapterOptions;
  constructor(opts: AgentSdkAdapterOptions = {}) { this.opts = opts; }

  async spawnRole(spec: RoleSpec): Promise<RoleResult> {
    const query: QueryFn = this.opts.queryFn ?? (await import('@anthropic-ai/claude-agent-sdk' as string)).query;
    const maxRetries = this.opts.maxRetries ?? 3;
    const baseDelay = this.opts.retryBaseDelayMs ?? 500;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // Collect the stream defensively + with bounded retry. The SDK can THROW mid-stream:
    // on TRANSIENT failures (529 Overloaded, socket close, ECONNRESET) we retry with
    // exponential backoff — re-running the role from scratch, since the SDK doesn't
    // checkpoint. On non-transient throws we stop and degrade gracefully below. Either
    // way spawnRole NEVER throws: an unguarded throw would crash the whole run and
    // discard the per-role usage + the files the agent already wrote.
    let collected: SdkMessage[] = [];
    let result: SdkResultMessage | undefined;
    let thrown: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      collected = [];
      result = undefined;
      thrown = undefined;
      try {
        for await (const message of query({ prompt: buildPrompt(spec), options: buildQueryOptions(spec, this.opts) })) {
          collected.push(message);
          if (message.type === 'result') result = message as SdkResultMessage;
        }
      } catch (e) {
        thrown = e;
      }
      // Retry only transient errors, and only while attempts remain. maxTurns is NOT
      // transient (re-running would just re-exhaust the budget) — it falls through to
      // the resumable-escalation path below.
      if (thrown !== undefined && isTransient(thrown) && !isMaxTurns(result, thrown) && attempt < maxRetries) {
        await sleep(Math.min(baseDelay * 2 ** attempt, 8000));
        continue;
      }
      break;
    }

    const finalText = lastAssistantText(collected);
    const artifacts = extractArtifacts(collected);
    const usage = mapUsage(result?.usage);
    const handoff = { model: spec.model, cost_usd: result?.total_cost_usd ?? 0, summary: finalText.slice(0, 1000) };

    // Turn-budget exhaustion — whether surfaced as a thrown error or an `error_max_turns`
    // result — degrades to a RESUMABLE escalation (the engine PAUSES), preserving the
    // partial artifacts + any usage. Raising --maxTurns and resuming re-runs the role.
    if (isMaxTurns(result, thrown)) {
      return degraded(spec, artifacts, usage, handoff,
        `exhausted its turn budget before signalling completion (${artifacts.length} file(s) already written). ` +
        `Raise --maxTurns and resume, or accept the partial result.`);
    }

    // Universal preserve-on-error: any terminal error (transient retries exhausted, or a
    // genuine failure) degrades to a resumable escalation with partial state preserved —
    // NEVER a bare crash that discards the run. The error text is surfaced in the
    // escalation so the operator sees what happened and can resume after fixing it.
    if (thrown !== undefined) {
      const msg = thrown instanceof Error ? thrown.message : String(thrown);
      return degraded(spec, artifacts, usage, handoff,
        `failed after ${maxRetries} retr${maxRetries === 1 ? 'y' : 'ies'}: ${msg.slice(0, 300)}. ` +
        `${artifacts.length} file(s) preserved; resume to retry the role.`);
    }

    const det = result && result.subtype !== 'success'
      ? { status: 'BLOCKED' as RoleStatus }
      : parseStatusContract(finalText, spec.role);

    return { role: spec.role, status: det.status, artifacts, handoff, usage, escalation: det.escalation };
  }
}

// Build a resumable-escalation RoleResult that preserves partial work. The engine turns
// an ESCALATE with no onEscalate handler into a PAUSED (resumable) run.
function degraded(
  spec: RoleSpec,
  artifacts: string[],
  usage: Usage,
  handoff: RoleResult['handoff'],
  reason: string,
): RoleResult {
  return {
    role: spec.role,
    status: 'ESCALATE',
    artifacts,
    handoff,
    usage,
    escalation: { question: `Role "${spec.role}" ${reason}`, raisedBy: spec.role },
  };
}

// True iff the role ended because it ran out of turns (resumable), as either an
// `error_max_turns` result subtype or a thrown "maximum number of turns" error.
export function isMaxTurns(result: SdkResultMessage | undefined, thrown: unknown): boolean {
  if (result?.subtype === 'error_max_turns') return true;
  if (thrown === undefined) return false;
  const msg = thrown instanceof Error ? thrown.message : String(thrown);
  return /max(?:imum)?[ _-]?(?:number of )?turns/i.test(msg);
}

// True iff a thrown error is a transient server/network failure worth retrying:
// overload (529), rate limit (429), gateway errors (502/503/504), and socket/connection
// drops. Deliberately conservative — anything not matched is treated as terminal.
export function isTransient(thrown: unknown): boolean {
  if (thrown === undefined || thrown === null) return false;
  const msg = (thrown instanceof Error ? thrown.message : String(thrown)).toLowerCase();
  return /\b(429|502|503|504|529)\b/.test(msg)
    || /overloaded|rate.?limit|too many requests/.test(msg)
    || /socket|econnreset|econnrefused|etimedout|epipe|network|fetch failed|connection (?:closed|reset|error)|terminated/.test(msg);
}
