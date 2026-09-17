/** @jest-environment node */
const mockConstruct = jest.fn();
const mockCommands: Array<{ url: string; operation: string; key: string }> = [];
jest.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(readonly config: { url: string; token: string }) {
      mockConstruct(config);
    }
    async get() {
      return this.config.url;
    }
    async set(key: string) {
      mockCommands.push({ url: this.config.url, operation: "set", key });
      return "OK";
    }
    async eval(_script: string, keys: string[]) {
      mockCommands.push({
        url: this.config.url,
        operation: "eval",
        key: keys[0],
      });
      return 1;
    }
  },
}));
import { createRedisClient } from "../redis";
import { acquireFreeRunConcurrencyLock } from "../free-concurrency";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";
const keys = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
const A = { url: "https://redis-a.example.test", token: "fixture-token-A" };
const B = { url: "https://redis-b.example.test", token: "fixture-token-B" };
function setConfig(config: typeof A) {
  process.env.UPSTASH_REDIS_REST_URL = config.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = config.token;
}
function configOf(client: ReturnType<typeof createRedisClient>) {
  return (client as unknown as { config: typeof A } | null)?.config;
}
beforeEach(() => {
  keys.forEach((k) => delete process.env[k]);
  createRedisClient();
  mockConstruct.mockReset();
  mockCommands.length = 0;
});
afterAll(() => {
  keys.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});
test("an initially missing configuration is not cached forever", () => {
  expect(createRedisClient()).toBeNull();
  setConfig(A);
  expect(configOf(createRedisClient())).toEqual(A);
});
test("unscoped rotation replaces cached client for token or URL changes", () => {
  setConfig(A);
  const a = createRedisClient();
  expect(createRedisClient()).toBe(a);
  setConfig({ ...A, token: B.token });
  const rotated = createRedisClient();
  expect(rotated).not.toBe(a);
  expect(configOf(rotated)).toEqual({ ...A, token: B.token });
  setConfig(B);
  expect(configOf(createRedisClient())).toEqual(B);
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  expect(createRedisClient()).toBeNull();
});
test("constructor failure does not poison the cache as unavailable", () => {
  setConfig(A);
  mockConstruct.mockImplementationOnce(() => {
    throw new Error("Fixture constructor failed");
  });
  expect(() => createRedisClient()).toThrow("Fixture constructor failed");
  expect(configOf(createRedisClient())).toEqual(A);
});
test("Vercel KV aliases still work and explicit Upstash fields retain precedence", () => {
  process.env.KV_REST_API_URL = B.url;
  process.env.KV_REST_API_TOKEN = B.token;
  expect(configOf(createRedisClient())).toEqual(B);
  setConfig(A);
  expect(configOf(createRedisClient())).toEqual(A);
});
test("a run captures config before awaits, including callbacks invoked from another run", async () => {
  setConfig(A);
  const cleanup = await withConvexClientScope(undefined, async () => {
    setConfig(B);
    await Promise.resolve();
    expect(configOf(createRedisClient())).toEqual(A);
    return bindConvexClientScope(createRedisClient);
  });
  await withConvexClientScope(undefined, async () => {
    expect(configOf(createRedisClient())).toEqual(B);
    expect(configOf(cleanup())).toEqual(A);
    expect(configOf(createRedisClient())).toEqual(B);
  });
});
test("a missing-key run cannot borrow credentials added after it started", async () => {
  await withConvexClientScope(undefined, async () => {
    setConfig(B);
    await Promise.resolve();
    expect(createRedisClient()).toBeNull();
  });
});
test("same endpoint runs have independent clients, cached within each run", () => {
  setConfig(A);
  const first = withConvexClientScope(undefined, () => {
    const client = createRedisClient();
    expect(createRedisClient()).toBe(client);
    return client;
  });
  const second = withConvexClientScope(undefined, createRedisClient);
  expect(first).not.toBe(second);
});

test("free-run locks and delayed release operate on their own Redis deployments", async () => {
  setConfig(A);
  const lockA = await withConvexClientScope(undefined, () =>
    acquireFreeRunConcurrencyLock("owner-A"),
  );
  setConfig(B);
  await withConvexClientScope(undefined, async () => {
    const lockB = await acquireFreeRunConcurrencyLock("owner-B");
    await lockA.refresh();
    await lockA.release();
    await lockB.release();
  });
  expect(mockCommands).toEqual([
    { url: A.url, operation: "set", key: "free_run_lock:owner-A" },
    { url: B.url, operation: "set", key: "free_run_lock:owner-B" },
    { url: A.url, operation: "eval", key: "free_run_lock:owner-A" },
    { url: A.url, operation: "eval", key: "free_run_lock:owner-A" },
    { url: B.url, operation: "eval", key: "free_run_lock:owner-B" },
  ]);
});
