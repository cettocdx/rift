import {
  createRunLease,
  getLeaseBySandbox,
  revokeRunLeases,
  recordProxyUsage,
  readRunUsage,
  acquireInflight,
  type RunLease,
} from "@/lib/opencode/run-lease";
import {
  mockSet,
  mockGet,
  mockDel,
  mockHincrby,
  mockHgetall,
  mockExpire,
  mockIncr,
} from "@/__mocks__/@upstash/redis";

const mockEval = jest.fn().mockResolvedValue(1);
jest.mock("@/lib/rate-limit/redis", () => ({
  createRedisClient: () => ({
    set: (...args: unknown[]) => mockSet(...args),
    get: (...args: unknown[]) => mockGet(...args),
    del: (...args: unknown[]) => mockDel(...args),
    hincrby: (...args: unknown[]) => mockHincrby(...args),
    hgetall: (...args: unknown[]) => mockHgetall(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
    incr: (...args: unknown[]) => mockIncr(...args),
    eval: (...args: unknown[]) => mockEval(...args),
  }),
}));

// Redis must look configured for createRedisClient() to return a client.
process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "tok";

const lease: RunLease = {
  runId: "run_1",
  chatId: "chat_1",
  userId: "user_1",
  sandboxId: "sbx_1",
  subscription: "pro",
  modelKey: "model-gpt-5.6-sol",
  ceilingDollars: 5,
  serverBaseUrl: "https://4096-sbx.e2b.app",
  serverAuth: "Basic zzz",
  createdAt: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("run-lease", () => {
  it("writes sandbox + chat + run indexes with a TTL", async () => {
    await createRunLease(lease);
    expect(mockSet).toHaveBeenCalledWith(
      "llm:lease:sandbox:sbx_1",
      JSON.stringify(lease),
      { ex: 4200 },
    );
    expect(mockSet).toHaveBeenCalledWith("llm:lease:chat:chat_1", "sbx_1", {
      ex: 4200,
    });
    expect(mockSet).toHaveBeenCalledWith("llm:lease:run:run_1", "sbx_1", {
      ex: 4200,
    });
  });

  it("reads a lease back by sandbox id (string or object)", async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify(lease));
    expect(await getLeaseBySandbox("sbx_1")).toEqual(lease);
    mockGet.mockResolvedValueOnce(lease as any);
    expect(await getLeaseBySandbox("sbx_1")).toEqual(lease);
  });

  it("returns null for a missing lease", async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await getLeaseBySandbox("gone")).toBeNull();
  });

  it("revokes atomically using the owning run and sandbox", async () => {
    mockGet.mockResolvedValueOnce("sbx_1");
    await revokeRunLeases("chat_1", "run_1");
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      [
        "llm:lease:chat:chat_1",
        "llm:lease:sandbox:sbx_1",
        "llm:lease:run:run_1",
      ],
      ["run_1", "sbx_1", "chat_1"],
    );
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("records usage as integer HINCRBY fields + cost in micros, and expires", async () => {
    await recordProxyUsage("run_1", {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      reasoningTokens: 8,
      costMicros: 12300,
    });
    expect(mockHincrby).toHaveBeenCalledWith(
      "llm:usage:run_1",
      "input_tokens",
      100,
    );
    expect(mockHincrby).toHaveBeenCalledWith(
      "llm:usage:run_1",
      "cost_micros",
      12300,
    );
    expect(mockHincrby).toHaveBeenCalledWith("llm:usage:run_1", "requests", 1);
    expect(mockExpire).toHaveBeenCalledWith("llm:usage:run_1", 86400);
  });

  it("reads usage totals back, converting micros to dollars", async () => {
    mockHgetall.mockResolvedValueOnce({
      input_tokens: "100",
      output_tokens: "20",
      cache_read_tokens: "40",
      reasoning_tokens: "8",
      requests: "3",
      cost_micros: "12300",
    });
    expect(await readRunUsage("run_1")).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      reasoningTokens: 8,
      requests: 3,
      costDollars: 0.0123,
    });
  });

  it("acquires an in-flight slot", async () => {
    mockIncr.mockResolvedValueOnce(2);
    expect(await acquireInflight("run_1")).toBe(2);
    expect(mockExpire).toHaveBeenCalledWith("llm:inflight:run_1", 900);
  });
});
