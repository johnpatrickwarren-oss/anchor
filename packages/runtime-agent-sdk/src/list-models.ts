// @anchor/runtime-agent-sdk — list the models the Anthropic API currently offers.
//
// The cheap half of model-drift detection: GET /v1/models → model ids, which the CLI diffs
// against the grounded routing provenance. No model tokens (a metadata list call). `fetchFn` is
// injected so this is unit-tested with no network; in prod it defaults to global fetch.

export interface ListModelsOptions {
  apiKey?: string;                // defaults to ANTHROPIC_API_KEY
  baseUrl?: string;               // defaults to https://api.anthropic.com
  fetchFn?: typeof fetch;         // injected in tests
  version?: string;               // anthropic-version header
}

interface ModelsPage { data: { id: string }[]; has_more?: boolean; last_id?: string | null; }

// Returns the available model ids (e.g. ['claude-opus-4-8', ...]), following pagination.
// Throws on a non-OK response or missing key — callers treat any failure as "skip the check"
// (drift detection is best-effort; a network hiccup must never block real work).
export async function listAvailableModels(opts: ListModelsOptions = {}): Promise<string[]> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('no ANTHROPIC_API_KEY for model listing');
  const f = opts.fetchFn ?? fetch;
  const base = opts.baseUrl ?? 'https://api.anthropic.com';
  const headers = { 'x-api-key': apiKey, 'anthropic-version': opts.version ?? '2023-06-01' };

  const ids: string[] = [];
  let afterId: string | null | undefined;
  for (let page = 0; page < 20; page++) { // bound: 20 pages × 1000 is far beyond the model count
    const url = `${base}/v1/models?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`;
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`/v1/models -> ${res.status}`);
    const body = (await res.json()) as ModelsPage;
    for (const m of body.data ?? []) ids.push(m.id);
    if (!body.has_more || !body.last_id) break;
    afterId = body.last_id;
  }
  return ids;
}
