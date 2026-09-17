import {
  isExecutionTargetAvailable,
  restoreExecutionTarget,
  availableLocalRunners,
} from "../execution-target";

it("offers fresh command runners first instead of stale connected records", () => {
  const now = 1_000_000_000;
  const runner = (
    connectionId: string,
    lastSeen: number,
    isDesktop = false,
  ) => ({
    connectionId,
    lastSeen,
    isDesktop,
    capabilities: { commands: true },
  });
  const rows = [
    runner("stale", 1),
    runner("older", now - 100_000),
    runner("current", now),
    runner("desktop", now, true),
  ];
  expect(availableLocalRunners(rows, now).map((r) => r.connectionId)).toEqual([
    "current",
    "older",
  ]);
  expect(rows[0].connectionId).toBe("stale");
});

it("preserves the selected computer across reloads even when it is offline", () => {
  const target = restoreExecutionTarget("offline-mac", "e2b", false);
  expect(target).toBe("offline-mac");
  expect(
    isExecutionTargetAvailable(target, [
      {
        connectionId: "other-mac",
        isDesktop: false,
        capabilities: { commands: true },
      },
    ]),
  ).toBe(false);
});

it("keeps a new chat's selection but clears the previous chat's local target", () => {
  expect(restoreExecutionTarget(null, "my-mac", true)).toBe("my-mac");
  expect(restoreExecutionTarget(null, "my-mac", false)).toBe("e2b");
});

it("preserves desktop intent for both current and legacy saved chats", () => {
  expect(restoreExecutionTarget("desktop", "e2b", false)).toBe("desktop");
  expect(restoreExecutionTarget("tauri", "e2b", false)).toBe("desktop");
});

it("requires an executable matching connection and distinguishes file-only desktop access", () => {
  const connections = [
    {
      connectionId: "file-relay",
      isDesktop: true,
      capabilities: { commands: false },
    },
    {
      connectionId: "my-mac",
      isDesktop: false,
      capabilities: { commands: true },
    },
  ];
  expect(isExecutionTargetAvailable("desktop", connections)).toBe(false);
  expect(isExecutionTargetAvailable("my-mac", connections)).toBe(true);
  expect(isExecutionTargetAvailable("e2b", [])).toBe(true);
});
