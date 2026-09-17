/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import {
  createRunLease,
  refreshRunLease,
  revokeRunLeases,
  type RunLease,
} from "./run-lease";

let mockSocket = "";
let mockBeforeEval: (() => void) | undefined;

function mockCommand(...args: string[]): string {
  return execFileSync("redis-cli", ["-s", mockSocket, "--raw", ...args], {
    encoding: "utf8",
  }).trim();
}

jest.mock("@/lib/rate-limit/redis", () => ({
  createRedisClient: () => ({
    get: async (key: string) => mockCommand("GET", key) || null,
    set: async (key: string, value: string, options: { ex: number }) =>
      mockCommand("SET", key, value, "EX", String(options.ex)),
    eval: async (script: string, keys: string[], args: string[]) => {
      mockBeforeEval?.();
      return Number(
        mockCommand("EVAL", script, String(keys.length), ...keys, ...args),
      );
    },
  }),
}));

const localRedisAvailable = (() => {
  try {
    execFileSync("redis-server", ["--version"], { stdio: "ignore" });
    execFileSync("redis-cli", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const baseLease: RunLease = {
  runId: "old-run",
  chatId: "chat",
  userId: "user",
  sandboxId: "old-sandbox",
  subscription: "pro",
  modelKey: "test",
  ceilingDollars: 1,
  serverBaseUrl: "http://localhost",
  serverAuth: "test-only",
  createdAt: 1,
};

// Uses an isolated Unix socket with no TCP listener or application credentials.
// Environments without local Redis retain the ordinary mocked contract suite.
(localRedisAvailable ? describe : describe.skip)(
  "run lease atomic cleanup (local Redis)",
  () => {
    let directory: string;
    beforeAll(async () => {
      directory = mkdtempSync("/tmp/rift-lease-");
      mockSocket = `${directory}/redis.sock`;
      execFileSync("redis-server", [
        "--port",
        "0",
        "--unixsocket",
        mockSocket,
        "--unixsocketperm",
        "700",
        "--save",
        "",
        "--appendonly",
        "no",
        "--daemonize",
        "yes",
        "--pidfile",
        `${directory}/redis.pid`,
        "--logfile",
        `${directory}/redis.log`,
      ]);
      // Daemonization returns before Redis necessarily accepts connections.
      // Wait for this isolated fixture, not an arbitrary fixed sleep.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try {
          const reply = execFileSync(
            "redis-cli",
            ["-s", mockSocket, "--raw", "PING"],
            {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
              timeout: 500,
            },
          ).trim();
          if (reply === "PONG") return;
        } catch {
          /* the fixture is still starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("Isolated Redis fixture did not become ready within 3s");
    });
    beforeEach(() => {
      mockBeforeEval = undefined;
      mockCommand("FLUSHDB");
    });
    afterAll(() => {
      try {
        mockCommand("SHUTDOWN", "NOSAVE");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("removes the old sandbox lease without deleting a replacement chat index", async () => {
      await createRunLease(baseLease);
      const replacement = {
        ...baseLease,
        runId: "new-run",
        sandboxId: "new-sandbox",
      };
      await createRunLease(replacement);
      await revokeRunLeases("chat", "old-run");
      expect(mockCommand("GET", "llm:lease:sandbox:old-sandbox")).toBe("");
      expect(mockCommand("GET", "llm:lease:run:old-run")).toBe("");
      expect(mockCommand("GET", "llm:lease:chat:chat")).toBe("new-sandbox");
      expect(
        JSON.parse(mockCommand("GET", "llm:lease:sandbox:new-sandbox")),
      ).toEqual(replacement);
    });

    it("preserves a replacement lease reusing the same sandbox", async () => {
      await createRunLease(baseLease);
      const replacement = { ...baseLease, runId: "new-run" };
      await createRunLease(replacement);
      await revokeRunLeases("chat", "old-run");
      expect(
        JSON.parse(mockCommand("GET", "llm:lease:sandbox:old-sandbox")),
      ).toEqual(replacement);
      expect(mockCommand("GET", "llm:lease:chat:chat")).toBe("old-sandbox");
      expect(mockCommand("GET", "llm:lease:run:new-run")).toBe("old-sandbox");
    });

    it("compares the lease atomically after a replacement arrives during cleanup", async () => {
      await createRunLease(baseLease);
      const replacement = { ...baseLease, runId: "new-run" };
      mockBeforeEval = () => {
        mockCommand(
          "SET",
          "llm:lease:sandbox:old-sandbox",
          JSON.stringify(replacement),
        );
        mockCommand("SET", "llm:lease:run:new-run", "old-sandbox");
      };
      await revokeRunLeases("chat", "old-run");
      expect(
        JSON.parse(mockCommand("GET", "llm:lease:sandbox:old-sandbox")),
      ).toEqual(replacement);
      expect(mockCommand("GET", "llm:lease:chat:chat")).toBe("old-sandbox");
    });

    it("revokes the matching current lease and all its indexes", async () => {
      await createRunLease(baseLease);
      await revokeRunLeases("chat", "old-run");
      expect(mockCommand("DBSIZE")).toBe("0");
    });

    it("does not resurrect a revoked lease through a delayed refresh", async () => {
      await createRunLease(baseLease);
      await revokeRunLeases("chat", "old-run");
      await refreshRunLease(baseLease);
      expect(mockCommand("DBSIZE")).toBe("0");
    });

    it.each(["old-sandbox", "new-sandbox"])(
      "preserves the new run when an old refresh arrives for %s",
      async (sandboxId) => {
        await createRunLease(baseLease);
        const replacement = { ...baseLease, runId: "new-run", sandboxId };
        await createRunLease(replacement);
        await refreshRunLease(baseLease);
        expect(mockCommand("GET", "llm:lease:chat:chat")).toBe(sandboxId);
        expect(
          JSON.parse(mockCommand("GET", `llm:lease:sandbox:${sandboxId}`)),
        ).toEqual(replacement);
      },
    );

    it("refreshes only the matching live lease and its indexes", async () => {
      await createRunLease(baseLease);
      for (const key of [
        "llm:lease:sandbox:old-sandbox",
        "llm:lease:chat:chat",
        "llm:lease:run:old-run",
      ]) {
        mockCommand("EXPIRE", key, "10");
      }
      const refreshed = { ...baseLease, ceilingDollars: 2 };
      await refreshRunLease(refreshed);
      expect(
        JSON.parse(mockCommand("GET", "llm:lease:sandbox:old-sandbox")),
      ).toEqual(refreshed);
      for (const key of [
        "llm:lease:sandbox:old-sandbox",
        "llm:lease:chat:chat",
        "llm:lease:run:old-run",
      ]) {
        expect(Number(mockCommand("TTL", key))).toBeGreaterThan(4100);
      }
    });

    it("supports a legacy lease without a run index but never revokes another run", async () => {
      await createRunLease(baseLease);
      mockCommand("DEL", "llm:lease:run:old-run");
      await revokeRunLeases("chat", "denied-run");
      expect(
        JSON.parse(mockCommand("GET", "llm:lease:sandbox:old-sandbox")),
      ).toEqual(baseLease);
      await revokeRunLeases("chat", "old-run");
      expect(mockCommand("DBSIZE")).toBe("0");
    });
  },
);
