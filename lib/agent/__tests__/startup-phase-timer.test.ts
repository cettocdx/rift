import {
  createStartupPhaseTimer,
  type StartupPhaseSpan,
} from "../startup-phase-timer";

test("telemetry failures cannot fail work or replace its original cancellation error", async () => {
  const timer = createStartupPhaseTimer(() => {
    throw new Error("metadata transport unavailable");
  });
  const result = { ready: true };
  const cancelled = new Error("execution cancelled");
  expect(timer.measureSync("tools", () => result)).toBe(result);
  await expect(timer.measure("setup", async () => result)).resolves.toBe(
    result,
  );
  expect(() =>
    timer.measureSync("fence", () => {
      throw cancelled;
    }),
  ).toThrow(cancelled);
  await expect(
    timer.measure("fence", async () => {
      throw cancelled;
    }),
  ).rejects.toBe(cancelled);
});

test("overlapping phases retain their own start/end rather than adding parallel durations", async () => {
  let clock = 1000;
  const spans: Record<string, StartupPhaseSpan> = {};
  const timer = createStartupPhaseTimer(
    (name, span) => {
      spans[name] = span;
    },
    () => clock,
  );
  let endA!: () => void, endB!: () => void;
  const a = timer.measure(
    "first",
    () =>
      new Promise<void>((r) => {
        endA = r;
      }),
  );
  clock = 1020;
  const b = timer.measure(
    "second",
    () =>
      new Promise<void>((r) => {
        endB = r;
      }),
  );
  clock = 1070;
  endB();
  await b;
  clock = 1100;
  endA();
  await a;
  expect(spans).toEqual({
    first: {
      startedMs: 0,
      endedMs: 100,
      durationMs: 100,
      outcome: "completed",
    },
    second: {
      startedMs: 20,
      endedMs: 70,
      durationMs: 50,
      outcome: "completed",
    },
  });
});

test("sync and rejected async phases preserve results/errors without recording their content", async () => {
  let clock = 0;
  const published: unknown[] = [];
  const timer = createStartupPhaseTimer(
    (name, span) => {
      published.push({ name, ...span });
    },
    () => clock,
  );
  const secretResult = { credential: "fixture-private-result" };
  expect(
    timer.measureSync("tools", () => {
      clock = 12;
      return secretResult;
    }),
  ).toBe(secretResult);
  const failure = new Error("fixture-private-error");
  await expect(
    timer.measure("denied", async () => {
      clock = 32;
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(published).toEqual([
    {
      name: "tools",
      startedMs: 0,
      endedMs: 12,
      durationMs: 12,
      outcome: "completed",
    },
    {
      name: "denied",
      startedMs: 12,
      endedMs: 32,
      durationMs: 20,
      outcome: "failed",
    },
  ]);
  expect(JSON.stringify(published)).not.toMatch(/credential|fixture-private/);
});
