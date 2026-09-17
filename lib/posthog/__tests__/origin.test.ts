/** @jest-environment node */
const mockClients: Array<{
  key: string;
  host: string;
  capture: jest.Mock;
  captureException: jest.Mock;
  flush: jest.Mock;
}> = [];
jest.mock("posthog-node", () => ({
  PostHog: class {
    capture = jest.fn();
    captureException = jest.fn();
    flush = jest.fn(async () => {});
    constructor(
      readonly key: string,
      options: { host: string },
    ) {
      mockClients.push({
        key,
        host: options.host,
        capture: this.capture,
        captureException: this.captureException,
        flush: this.flush,
      });
    }
  },
}));
import { getTelemetryDeliveryStats } from "../delivery-stats";
import PostHogClient from "@/app/posthog";
import { phLogger } from "../server";
import { emitPostHogLog, flushPostHogLogs } from "../logs";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";
const names = [
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "POSTHOG_PROJECT_TOKEN",
  "POSTHOG_LOG_HOST",
  "POSTHOG_LOG_SERVICE_NAME",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
] as const;
const saved = Object.fromEntries(names.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; key: string | null; body: any }> = [];
function config(origin: string) {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = `analytics-${origin}`;
  process.env.NEXT_PUBLIC_POSTHOG_HOST = `https://analytics-${origin}.example.test`;
  process.env.POSTHOG_PROJECT_TOKEN = `logs-${origin}`;
  process.env.POSTHOG_LOG_HOST = `https://logs-${origin}.example.test`;
  process.env.POSTHOG_LOG_SERVICE_NAME = `service-${origin}`;
  process.env.VERCEL_ENV = `env-${origin}`;
  process.env.VERCEL_GIT_COMMIT_SHA = `version-${origin}`;
}
const emit = (body: string) =>
  emitPostHogLog({ level: "info", event: "fixture", body });
const records = (request: (typeof requests)[number]) =>
  request.body.resourceLogs[0].scopeLogs[0].logRecords;
beforeEach(() => {
  requests.length = 0;
  mockClients.length = 0;
  jest.useFakeTimers();
  globalThis.fetch = jest.fn(async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      key: request.headers.get("authorization"),
      body: JSON.parse(await request.text()),
    });
    return new Response("", { status: 200 });
  });
});
afterEach(async () => {
  await phLogger.flush();
  jest.clearAllTimers();
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

it("separates scoped queues and keeps A resource/destination when B flushes first", async () => {
  config("a");
  const flushA = withConvexClientScope(undefined, () => {
    emit("message-a");
    return bindConvexClientScope(flushPostHogLogs);
  });
  config("b");
  await withConvexClientScope(undefined, async () => {
    emit("message-b");
    await flushPostHogLogs();
  });
  expect(requests).toHaveLength(1);
  expect(records(requests[0]).map((row: any) => row.body.stringValue)).toEqual([
    "message-b",
  ]);
  await flushA();
  expect(requests.map((request) => [request.url, request.key])).toEqual([
    ["https://logs-b.example.test/i/v1/logs", "Bearer logs-b"],
    ["https://logs-a.example.test/i/v1/logs", "Bearer logs-a"],
  ]);
  expect(requests[1].body.resourceLogs[0].resource.attributes).toEqual(
    expect.arrayContaining([
      { key: "service.name", value: { stringValue: "service-a" } },
      { key: "deployment.environment", value: { stringValue: "env-a" } },
      { key: "service.version", value: { stringValue: "version-a" } },
    ]),
  );
  expect(JSON.stringify(requests.map((request) => request.body))).not.toMatch(
    /analytics-[ab]|logs-[ab]/,
  );
});

it("binds event clients and direct factory calls to their originating scope", async () => {
  config("a");
  const lateA = withConvexClientScope(undefined, () => {
    phLogger.event("event-a");
    return bindConvexClientScope(() => {
      phLogger.event("late-a");
      return PostHogClient();
    });
  });
  config("b");
  await withConvexClientScope(undefined, async () => {
    phLogger.event("event-b");
    lateA();
    await phLogger.flush();
  });
  expect(mockClients.map((client) => client.key)).toEqual([
    "analytics-a",
    "analytics-b",
    "analytics-a",
  ]);
  expect(
    mockClients[0].capture.mock.calls.map(([event]) => event.event),
  ).toEqual(["event-a", "late-a"]);
  expect(mockClients[1].capture.mock.calls[0][0].event).toBe("event-b");
});

it("does not borrow missing origin tokens after another configuration becomes available", async () => {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.POSTHOG_PROJECT_TOKEN;
  await withConvexClientScope(undefined, async () => {
    config("b");
    expect(emit("must-not-send")).toBe(false);
    expect(PostHogClient()).toBeNull();
    phLogger.event("must-not-send");
    await phLogger.flush();
  });
  expect(mockClients).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

it("retries a failed A batch under A after B changes the environment", async () => {
  config("a");
  const fetcher = globalThis.fetch as jest.Mock;
  fetcher.mockResolvedValueOnce(new Response("", { status: 503 }));
  await withConvexClientScope(undefined, async () => {
    emit("retry-a");
    await expect(flushPostHogLogs()).rejects.toThrow("503");
  });
  config("b");
  await jest.advanceTimersByTimeAsync(2001);
  expect(requests).toHaveLength(1);
  expect(requests[0].key).toBe("Bearer logs-a");
  expect(requests[0].url).toBe("https://logs-a.example.test/i/v1/logs");
});

it("drains event clients from previous unscoped destinations on process flush", async () => {
  config("unscoped-a");
  phLogger.event("event-a");
  config("unscoped-b");
  phLogger.event("event-b");
  await phLogger.flush();
  expect(mockClients).toHaveLength(2);
  expect(mockClients.map((client) => client.flush.mock.calls.length)).toEqual([
    1, 1,
  ]);
});

it("retains the aggregate 1000-record limit and 50-record batches across origins", async () => {
  config("a");
  withConvexClientScope(undefined, () => {
    for (let index = 0; index < 600; index++)
      expect(emit(`a-${index}`)).toBe(true);
  });
  config("b");
  withConvexClientScope(undefined, () => {
    for (let index = 0; index < 405; index++)
      expect(emit(`b-${index}`)).toBe(true);
  });
  await flushPostHogLogs();
  const bodies = requests.flatMap((request) =>
    records(request).map((row: any) => row.body.stringValue),
  );
  expect(bodies).toHaveLength(1000);
  expect(new Set(bodies).size).toBe(1000);
  expect(bodies).not.toContain("a-4");
  expect(bodies).toContain("a-5");
  for (const request of requests) {
    expect(records(request).length).toBeLessThanOrEqual(50);
    const origin = request.key === "Bearer logs-a" ? "a" : "b";
    expect(
      records(request).every((row: any) =>
        row.body.stringValue.startsWith(`${origin}-`),
      ),
    ).toBe(true);
  }
});

it("bounds actively flushing origins and frees capacity after a successful drain", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input, init) => {
    await gate;
    return fetcher(input, init);
  });
  const pending: Promise<void>[] = [];
  for (let index = 0; index < 32; index++) {
    config(String(index));
    pending.push(
      withConvexClientScope(undefined, async () => {
        expect(emit(`origin-${index}`)).toBe(true);
        await flushPostHogLogs();
      }),
    );
  }
  config("overflow");
  withConvexClientScope(undefined, () => expect(emit("overflow")).toBe(false));
  release();
  await Promise.all(pending);
  expect(requests).toHaveLength(32);
  withConvexClientScope(undefined, () =>
    expect(emit("after-drain")).toBe(true),
  );
  await flushPostHogLogs();
  expect(requests).toHaveLength(33);
});

it("joins concurrent flushes without losing logs appended during the first batch", async () => {
  config("a");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input, init) => {
    await gate;
    return fetcher(input, init);
  });
  await withConvexClientScope(undefined, async () => {
    emit("first");
    const first = flushPostHogLogs();
    const second = flushPostHogLogs();
    await Promise.resolve();
    emit("second");
    release();
    await Promise.all([first, second]);
  });
  expect(
    requests.flatMap((request) =>
      records(request).map((row: any) => row.body.stringValue),
    ),
  ).toEqual(["first", "second"]);
});

it("preserves unscoped destination defaults and empty-token opt-out", async () => {
  config("a");
  delete process.env.POSTHOG_LOG_HOST;
  delete process.env.POSTHOG_PROJECT_TOKEN;
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.posthog.com/";
  expect(emit("fallback-token")).toBe(true);
  process.env.POSTHOG_PROJECT_TOKEN = "";
  expect(emit("disabled")).toBe(false);
  await flushPostHogLogs();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://eu.i.posthog.com/i/v1/logs");
  expect(requests[0].key).toBe("Bearer analytics-a");
});

it("keeps captures arriving during an SDK flush pending for the next flush", async () => {
  config("a");
  await withConvexClientScope(undefined, async () => {
    phLogger.event("first");
    const client = mockClients[0];
    let release!: () => void;
    client.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const firstFlush = phLogger.flush();
    phLogger.event("second");
    release();
    await firstFlush;
    await phLogger.flush();
    expect(client.flush).toHaveBeenCalledTimes(2);
  });
});

it("bounds actively flushing SDK clients and frees slots after successful flush", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending: Promise<void>[] = [];
  for (let index = 0; index < 32; index++) {
    config(String(index));
    pending.push(
      withConvexClientScope(undefined, async () => {
        phLogger.event(`event-${index}`);
        mockClients.at(-1)!.flush.mockImplementationOnce(() => gate);
        await phLogger.flush();
      }),
    );
  }
  config("overflow");
  withConvexClientScope(undefined, () => phLogger.event("overflow"));
  expect(mockClients).toHaveLength(32);
  release();
  await Promise.all(pending);
  withConvexClientScope(undefined, () => phLogger.event("after-drain"));
  expect(mockClients).toHaveLength(33);
});

it("restores labels and both destinations for a late bound logger callback", async () => {
  config("a");
  const callback = withConvexClientScope(undefined, () =>
    bindConvexClientScope(async () => {
      phLogger.warn("late-warning", {
        userId: "fixture-user",
        request_id: "fixture-request",
      });
      await phLogger.flush();
    }),
  );
  config("b");
  await withConvexClientScope(undefined, callback);
  expect(requests[0].key).toBe("Bearer logs-a");
  expect(mockClients[0].key).toBe("analytics-a");
  expect(mockClients[0].capture.mock.calls[0][0].properties).toMatchObject({
    service: "service-a",
    environment: "env-a",
    request_id: "fixture-request",
  });
});

it("admits a healthy new log origin after 32 failed origins without rerouting old records", async () => {
  const before = getTelemetryDeliveryStats();
  for (let index = 0; index < 32; index++) {
    config(`failed-${index}`);
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response("", { status: 503 }),
    );
    await withConvexClientScope(undefined, async () => {
      emit(`old-${index}`);
      await expect(flushPostHogLogs()).rejects.toThrow("503");
    });
  }
  config("healthy");
  await withConvexClientScope(undefined, async () => {
    expect(emit("healthy-only")).toBe(true);
    await flushPostHogLogs();
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].key).toBe("Bearer logs-healthy");
  expect(
    getTelemetryDeliveryStats().droppedLogRecords - before.droppedLogRecords,
  ).toBe(1);
  expect(records(requests[0]).map((row: any) => row.body.stringValue)).toEqual([
    "healthy-only",
  ]);
});

it("admits a healthy event client after 32 failed client flushes", async () => {
  const before = getTelemetryDeliveryStats();
  for (let index = 0; index < 32; index++) {
    config(`failed-client-${index}`);
    await withConvexClientScope(undefined, async () => {
      phLogger.event(`old-${index}`);
      mockClients.at(-1)!.flush.mockRejectedValueOnce(new Error("offline"));
      await phLogger.flush();
    });
  }
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  withConvexClientScope(undefined, () => phLogger.event("unconfigured"));
  expect(
    getTelemetryDeliveryStats().retiredAnalyticsClients -
      before.retiredAnalyticsClients,
  ).toBe(0);
  config("healthy-client");
  await withConvexClientScope(undefined, async () => {
    phLogger.event("healthy-event");
    await phLogger.flush();
  });
  expect(mockClients).toHaveLength(33);
  expect(mockClients[32].key).toBe("analytics-healthy-client");
  expect(
    getTelemetryDeliveryStats().retiredAnalyticsClients -
      before.retiredAnalyticsClients,
  ).toBe(1);
  expect(mockClients[32].capture.mock.calls[0][0].event).toBe("healthy-event");
});
