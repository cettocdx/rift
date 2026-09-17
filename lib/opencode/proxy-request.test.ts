import { prepareUpstreamRequest } from "@/lib/opencode/proxy-request";

const base = {
  model: "model-gpt-5.6-sol",
  stream: true,
  messages: [{ role: "user", content: "hi" }],
};

describe("prepareUpstreamRequest", () => {
  it("maps providerKey to the OpenRouter slug and forces usage accounting", () => {
    const r = prepareUpstreamRequest({ body: base, maxOutputTokens: 30000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slug).toBe("openai/gpt-5.6-sol");
    expect(r.body.model).toBe("openai/gpt-5.6-sol");
    expect(r.body.stream_options).toEqual({ include_usage: true });
    expect(r.body.usage).toEqual({ include: true });
    expect(r.body.max_tokens).toBe(30000);
  });

  it("rejects a non-allowlisted model with 400", () => {
    const r = prepareUpstreamRequest({ body: { ...base, model: "openai/gpt-5.6-sol" }, maxOutputTokens: 30000 });
    expect(r).toMatchObject({ ok: false, status: 400, code: "model_not_allowed" });
  });

  it("rejects a non-object body", () => {
    expect(prepareUpstreamRequest({ body: "nope", maxOutputTokens: 1 })).toMatchObject({ ok: false, code: "invalid_body" });
  });

  it("clamps oversized max_tokens and defaults when absent", () => {
    const clamped = prepareUpstreamRequest({ body: { ...base, max_tokens: 999999 }, maxOutputTokens: 30000 });
    expect(clamped.ok && clamped.body.max_tokens).toBe(30000);
    const defaulted = prepareUpstreamRequest({ body: base, maxOutputTokens: 12345 });
    expect(defaulted.ok && defaulted.body.max_tokens).toBe(12345);
  });

  it("strips client-supplied routing fields", () => {
    const r = prepareUpstreamRequest({
      body: { ...base, user: "attacker", provider: { order: ["x"] }, transforms: ["middle-out"] },
      maxOutputTokens: 30000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.user).toBeUndefined();
    expect(r.body.provider).toBeUndefined();
    expect(r.body.transforms).toBeUndefined();
  });

  it("merges RIFT provider options over the client body", () => {
    const r = prepareUpstreamRequest({
      body: base,
      maxOutputTokens: 30000,
      providerOptions: { reasoning: { enabled: true, effort: "high" }, models: ["a", "b"] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.reasoning).toEqual({ enabled: true, effort: "high" });
    expect(r.body.models).toEqual(["a", "b"]);
  });

  it("omits stream_options for a non-streaming request", () => {
    const r = prepareUpstreamRequest({ body: { ...base, stream: false }, maxOutputTokens: 30000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.stream_options).toBeUndefined();
    expect(r.body.usage).toEqual({ include: true });
  });
});
