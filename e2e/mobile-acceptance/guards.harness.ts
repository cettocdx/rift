import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { installReadOnlyGuard } from "./read-only-guard";
import { waitForAgentsReady } from "./agents-readiness";

// Use the installed Playwright runtime's existing ws implementation. No new
// dependency or external service; this server records what crossed the guard.
const runtimeRequire = createRequire(require.resolve("playwright"));
interface Peer {
  on(event: "message", callback: (data: Buffer) => void): void;
  send(message: string): void;
  terminate(): void;
}
const { wsServer: WebSocketServer } = runtimeRequire(
  "playwright-core/lib/utilsBundle",
) as {
  wsServer: new (options: { server: ReturnType<typeof createServer> }) => {
    on(event: "connection", callback: (peer: Peer) => void): void;
    clients: Set<Peer>;
    close(): void;
  };
};

test("Convex guard forwards auth/subscriptions and server replies but blocks writes on every connection", async ({
  context,
  page,
}) => {
  const received: string[] = [];
  const server = createServer((_request, response) => response.end("ok"));
  const ws = new WebSocketServer({ server });
  ws.on("connection", (peer) =>
    peer.on("message", (data) => {
      const value = JSON.parse(data.toString());
      received.push(value.type);
      peer.send(JSON.stringify({ type: "ack", received: value.type }));
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const blocked: string[] = [];
  try {
    await installReadOnlyGuard(context, origin, origin, blocked);
    await page.goto(origin);
    const replies = await page.evaluate(async (url) => {
      const all: string[] = [];
      for (let connection = 0; connection < 2; connection++) {
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(
            url.replace("http:", "ws:") + "/api/1.0/sync",
          );
          socket.onerror = () =>
            reject(new Error("Local harness socket failed"));
          socket.onmessage = (event) => {
            const reply = JSON.parse(event.data);
            all.push(reply.received);
            if (reply.received === "Event") {
              socket.close();
              resolve();
            }
          };
          socket.onopen = () => {
            for (const frame of [
              { type: "Connect", sessionId: "local-harness" },
              {
                type: "Authenticate",
                tokenType: "User",
                value: "synthetic-secret",
              },
              { type: "ModifyQuerySet", modifications: [] },
              {
                type: "Mutation",
                udfPath: "referrals:markRewardNotificationsSeen",
                args: [{ private: "do-not-log" }],
              },
              { type: "Action", udfPath: "tasks:run", args: [] },
              { type: "FutureWrite", args: ["do-not-log"] },
            ])
              socket.send(JSON.stringify(frame));
            socket.send("malformed-json");
            socket.send(
              new TextEncoder().encode(
                JSON.stringify({
                  type: "Action",
                  udfPath: "tasks:binary",
                  args: [],
                }),
              ),
            );
            socket.send(
              JSON.stringify({
                type: "Event",
                eventType: "barrier",
                event: {},
              }),
            );
          };
        });
      }
      return all;
    }, origin);
    const allowed = ["Connect", "Authenticate", "ModifyQuerySet", "Event"];
    expect(received).toEqual([...allowed, ...allowed]);
    expect(replies).toEqual(received);
    expect(blocked).toEqual([
      "Convex Mutation referrals:markRewardNotificationsSeen",
      "Convex Action tasks:run",
      "Convex unsupported client frame",
      "Convex unsupported client frame",
      "Convex Action tasks:binary",
      "Convex Mutation referrals:markRewardNotificationsSeen",
      "Convex Action tasks:run",
      "Convex unsupported client frame",
      "Convex unsupported client frame",
      "Convex Action tasks:binary",
    ]);
    expect(JSON.stringify(blocked)).not.toMatch(/synthetic-secret|do-not-log/);
  } finally {
    for (const peer of ws.clients) peer.terminate();
    ws.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("agents readiness rejects a visible selector while the team is loading", async ({
  page,
}) => {
  await page.setContent(
    '<select aria-label="Project" disabled><option>Existing project</option></select><div role="status">Loading your team…</div>',
  );
  await expect(waitForAgentsReady(page, 100)).rejects.toThrow();
  await page.locator("select").evaluate((el) => {
    el.removeAttribute("disabled");
  });
  await expect(waitForAgentsReady(page, 100)).rejects.toThrow();
});

for (const state of ["no-project", "empty-team", "team"] as const) {
  test(`agents readiness accepts the loaded ${state} surface`, async ({
    page,
  }) => {
    const surface =
      state === "no-project"
        ? "<h2>Start with a project</h2>"
        : state === "empty-team"
          ? "<h2>Build your project team</h2>"
          : '<aside aria-label="Project team">A bot</aside>';
    await page.setContent(
      `<select aria-label="Project"><option>Existing project</option></select>${surface}`,
    );
    await waitForAgentsReady(page, 100);
  });
}

test("Convex HTTP guard permits actual query endpoints and rejects writes before server receipt", async ({
  context,
  page,
}) => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === "POST") received.push(request.url!);
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const blocked: string[] = [];
  try {
    await installReadOnlyGuard(
      context,
      "http://unused-app.invalid",
      origin,
      blocked,
    );
    await page.goto(origin);
    const results = await page.evaluate(async () => {
      const results: boolean[] = [];
      for (const path of [
        "query",
        "query_ts",
        "query_at_ts",
        "mutation",
        "action",
        "function",
      ]) {
        results.push(
          await fetch(`/api/${path}`, { method: "POST", body: "{}" }).then(
            () => true,
            () => false,
          ),
        );
      }
      return results;
    });
    expect(results).toEqual([true, true, true, false, false, false]);
    expect(received).toEqual([
      "/api/query",
      "/api/query_ts",
      "/api/query_at_ts",
    ]);
    expect(blocked).toEqual([
      "POST /api/mutation",
      "POST /api/action",
      "POST /api/function",
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
