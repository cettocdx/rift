/** @jest-environment node */
import { PostHog } from "posthog-node";
import { phLogger } from "../server";
import { getTelemetryDeliveryStats } from "../delivery-stats";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";

it("protects actual SDK threshold flushes from retirement and waits for originating completion", async () => {
  const names = [
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
  ] as const;
  const saved = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const destinations: string[] = [];
  // Pass through to the installed SDK; only its HTTP transport is stubbed.
  const sdkFlush = jest.spyOn(PostHog.prototype, "flush");
  const before = getTelemetryDeliveryStats();
  globalThis.fetch = jest.fn(async (url) => {
    destinations.push(String(url));
    if (destinations.length === 32) started();
    await gate;
    return new Response(JSON.stringify({ status: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const finish: Array<() => Promise<void>> = [];
  try {
    for (let origin = 0; origin < 32; origin++) {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = `fixture-origin-${origin}`;
      process.env.NEXT_PUBLIC_POSTHOG_HOST = `https://origin-${origin}.example.test`;
      finish.push(
        withConvexClientScope(undefined, () => {
          for (let event = 0; event < 20; event++)
            phLogger.event(`fixture-${event}`, { userId: "fixture-user" });
          return bindConvexClientScope(() => phLogger.flush());
        }),
      );
    }
    await allStarted;
    expect(sdkFlush).toHaveBeenCalledTimes(32);
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "fixture-overflow";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://overflow.example.test";
    withConvexClientScope(undefined, () =>
      phLogger.event("overflow", { userId: "fixture-user" }),
    );
    let finished = false;
    const firstFinish = finish[0]().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    const after = getTelemetryDeliveryStats();
    expect(after.retiredAnalyticsClients - before.retiredAnalyticsClients).toBe(
      0,
    );
    expect(after.rejectedAnalyticsEvents - before.rejectedAnalyticsEvents).toBe(
      1,
    );
    release();
    await firstFinish;
    await phLogger.flush();
    expect(destinations).toHaveLength(32);
    expect(
      destinations.every((url) =>
        /https:\/\/origin-\d+\.example\.test\/batch\//.test(url),
      ),
    ).toBe(true);
  } finally {
    release();
    await phLogger.flush();
    await Promise.allSettled(
      sdkFlush.mock.results.map((result) => result.value),
    );
    sdkFlush.mockRestore();
    globalThis.fetch = previousFetch;
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
