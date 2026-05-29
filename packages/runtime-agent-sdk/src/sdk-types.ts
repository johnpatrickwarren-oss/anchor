// @anchor/runtime-agent-sdk — minimal structural types for the slice of the Claude Agent
// SDK this adapter consumes. The real types come from `@anthropic-ai/claude-agent-sdk`;
// these structural shapes let the adapter compile + be unit-tested without the SDK installed
// (the SDK is a peer dependency, dynamically imported only on the live path).
//
// Verified against code.claude.com/docs/en/agent-sdk/typescript (2026-05-29):
//   query({prompt, options}) -> async iterable of SDKMessage; the final {type:'result'}
//   message carries total_cost_usd + usage{input_tokens, output_tokens,
//   cache_creation_input_tokens, cache_read_input_tokens}.

export interface SdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface SdkToolUseBlock { type: 'tool_use'; name: string; input: Record<string, unknown>; }
export interface SdkTextBlock { type: 'text'; text: string; }
export type SdkContentBlock = SdkToolUseBlock | SdkTextBlock | { type: string; [k: string]: unknown };

export interface SdkAssistantMessage {
  type: 'assistant';
  message: { content: SdkContentBlock[] };
}

export interface SdkResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | string;
  total_cost_usd?: number;
  usage?: SdkUsage;
}

export type SdkMessage = SdkAssistantMessage | SdkResultMessage | { type: string; [k: string]: unknown };

export interface SdkQueryOptions {
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
  maxTurns?: number;
}

// The shape of the SDK's `query` we depend on (injectable for tests).
export type QueryFn = (args: { prompt: string; options?: SdkQueryOptions }) => AsyncIterable<SdkMessage>;
