/**
 * Pass-through SSE tap that tallies token usage and cost from an OpenAI-compatible
 * streaming completion (as served by OpenRouter through the RIFT proxy).
 *
 * The proxy must forward the upstream byte stream to OpenCode untouched — any
 * reframing risks corrupting tool-call or reasoning deltas — while still reading
 * the trailing `usage` frame so the run can be billed. So this is a byte-exact
 * `TransformStream`: bytes out === bytes in; it only *observes*, line-buffering
 * `data:` frames and parsing the ones that carry usage/model, and reports the
 * final tally on flush. Non-streaming callers use `parseUsageFromJson` directly.
 */

export interface ProxyUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costDollars: number;
  servedModel?: string;
  generationId?: string;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Extract usage from a parsed OpenAI/OpenRouter completion object (stream frame or full JSON). */
export function extractUsage(obj: unknown, into: ProxyUsage): void {
  if (typeof obj !== "object" || obj === null) return;
  const o = obj as Record<string, unknown>;
  const model = str(o.model);
  if (model) into.servedModel = model;
  const id = str(o.id);
  if (id) into.generationId = id;
  const usage = o.usage;
  if (typeof usage === "object" && usage !== null) {
    const u = usage as Record<string, unknown>;
    // Later frames carry the cumulative usage; overwrite rather than add.
    if (u.prompt_tokens !== undefined) into.inputTokens = num(u.prompt_tokens);
    if (u.completion_tokens !== undefined) into.outputTokens = num(u.completion_tokens);
    if (u.cost !== undefined) into.costDollars = num(u.cost);
    const pd = u.prompt_tokens_details;
    if (typeof pd === "object" && pd !== null) {
      into.cachedTokens = num((pd as Record<string, unknown>).cached_tokens);
    }
    const cd = u.completion_tokens_details;
    if (typeof cd === "object" && cd !== null) {
      into.reasoningTokens = num((cd as Record<string, unknown>).reasoning_tokens);
    }
  }
}

export function parseUsageFromJson(json: unknown): ProxyUsage {
  const usage: ProxyUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costDollars: 0,
  };
  extractUsage(json, usage);
  return usage;
}

/**
 * A byte-identical passthrough transform that reports usage on flush.
 * `onUsage` is called exactly once when the stream ends (never if it aborts
 * before any usage frame — the tally is only reported if tokens or cost were
 * seen).
 */
export function createUsageTallyTransform(
  onUsage: (usage: ProxyUsage) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let textBuffer = "";
  const usage: ProxyUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costDollars: 0,
  };
  let sawUsage = false;

  const consumeLine = (line: string) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    // Cheap guard: only parse frames that could carry usage/model.
    if (!payload.includes('"usage"') && !payload.includes('"model"')) return;
    try {
      const before = JSON.stringify(usage);
      extractUsage(JSON.parse(payload), usage);
      if (JSON.stringify(usage) !== before) sawUsage = true;
    } catch {
      /* ignore unparsable frame */
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); // byte-exact passthrough, first
      textBuffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = textBuffer.indexOf("\n")) >= 0) {
        consumeLine(textBuffer.slice(0, nl));
        textBuffer = textBuffer.slice(nl + 1);
      }
    },
    flush() {
      if (textBuffer) consumeLine(textBuffer);
      if (sawUsage) onUsage(usage);
    },
  });
}
