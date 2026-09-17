import {
  signRunToken,
  verifyRunToken,
  type RunTokenClaims,
} from "@/lib/llm-proxy/token";

const claims: RunTokenClaims = {
  runId: "run_1",
  chatId: "chat_1",
  userId: "user_1",
  sandboxId: "sbx_1",
};

describe("llm-proxy run token", () => {
  const OLD = process.env.LLM_PROXY_SECRET;
  beforeAll(() => {
    process.env.LLM_PROXY_SECRET = "test-secret-abc";
  });
  afterAll(() => {
    process.env.LLM_PROXY_SECRET = OLD;
  });

  it("round-trips a valid token", () => {
    expect(verifyRunToken(signRunToken(claims))).toEqual(claims);
  });

  it("accepts a Bearer-prefixed token", () => {
    expect(verifyRunToken(`Bearer ${signRunToken(claims)}`)).toEqual(claims);
  });

  it("rejects null / malformed input", () => {
    expect(verifyRunToken(null)).toBeNull();
    expect(verifyRunToken(undefined)).toBeNull();
    expect(verifyRunToken("")).toBeNull();
    expect(verifyRunToken("no-dot")).toBeNull();
    expect(verifyRunToken("a.b.c")).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const t = signRunToken(claims);
    const [body] = t.split(".");
    expect(verifyRunToken(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a tampered body", () => {
    const t = signRunToken(claims);
    const sig = t.split(".")[1];
    const forged = Buffer.from(
      JSON.stringify({ v: 1, r: "x", c: "x", u: "attacker", s: "x", e: Date.now() + 1e6 }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifyRunToken(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyRunToken(signRunToken(claims, -1))).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const t = signRunToken(claims);
    process.env.LLM_PROXY_SECRET = "different-secret";
    expect(verifyRunToken(t)).toBeNull();
    process.env.LLM_PROXY_SECRET = "test-secret-abc";
  });

  it("throws when no secret is configured", () => {
    const savedProxy = process.env.LLM_PROXY_SECRET;
    const savedConvex = process.env.CONVEX_SERVICE_ROLE_KEY;
    delete process.env.LLM_PROXY_SECRET;
    delete process.env.CONVEX_SERVICE_ROLE_KEY;
    expect(() => signRunToken(claims)).toThrow(/LLM_PROXY_SECRET/);
    process.env.LLM_PROXY_SECRET = savedProxy;
    if (savedConvex !== undefined) process.env.CONVEX_SERVICE_ROLE_KEY = savedConvex;
  });
});
