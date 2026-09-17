import {
  GOAL_OBJECTIVE_MAX_LENGTH,
  TaskGoalStore,
  createBrowserLocalStorageAdapter,
  deserializeTaskGoal,
  executeGoalCommand,
  getGoalStorageKey,
  parseGoalCommand,
  type GoalStorageAdapter,
} from "../goal-store";

function createMemoryStorage(): GoalStorageAdapter & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe("parseGoalCommand", () => {
  it.each([
    ["/goal", { kind: "command", command: { action: "view" } }],
    ["  /goal  ", { kind: "command", command: { action: "view" } }],
    [
      "/goal Ship the billing flow",
      {
        kind: "command",
        command: { action: "set", objective: "Ship the billing flow" },
      },
    ],
    [
      "/goal edit Ship the verified billing flow",
      {
        kind: "command",
        command: {
          action: "edit",
          objective: "Ship the verified billing flow",
        },
      },
    ],
    ["/goal pause", { kind: "command", command: { action: "pause" } }],
    ["/goal resume", { kind: "command", command: { action: "resume" } }],
    ["/goal clear", { kind: "command", command: { action: "clear" } }],
    ["/goal view", { kind: "command", command: { action: "view" } }],
  ])("parses %s deterministically", (input, expected) => {
    expect(parseGoalCommand(input)).toEqual(expected);
  });

  it("asks for an objective when edit has no text", () => {
    expect(parseGoalCommand("/goal edit")).toEqual({
      kind: "needs_input",
      action: "edit",
      message: "Enter the updated goal objective.",
    });
  });

  it("rejects extra arguments for state-only commands", () => {
    expect(parseGoalCommand("/goal pause until tomorrow")).toMatchObject({
      kind: "invalid",
      reason: "unexpected_arguments",
    });
  });

  it("rejects an overlong objective and ignores unrelated slash commands", () => {
    expect(
      parseGoalCommand(`/goal ${"x".repeat(GOAL_OBJECTIVE_MAX_LENGTH + 1)}`),
    ).toMatchObject({ kind: "invalid", reason: "objective_too_long" });
    expect(parseGoalCommand("/goals something")).toEqual({
      kind: "not_goal_command",
    });
    expect(parseGoalCommand("hello /goal")).toEqual({
      kind: "not_goal_command",
    });
  });
});

describe("TaskGoalStore", () => {
  it("supports the full set, view, edit, pause, resume, and clear lifecycle", () => {
    const storage = createMemoryStorage();
    let now = 100;
    const store = new TaskGoalStore(storage, { now: () => now });

    expect(store.view("task-a")).toEqual({
      ok: true,
      goal: null,
      changed: false,
    });

    const setResult = store.set("task-a", "  Build a release-ready app  ");
    expect(setResult).toEqual({
      ok: true,
      changed: true,
      goal: {
        version: 1,
        taskId: "task-a",
        objective: "Build a release-ready app",
        status: "active",
        createdAt: 100,
        updatedAt: 100,
      },
    });

    now = 200;
    expect(store.edit("task-a", "Build and verify the app")).toMatchObject({
      ok: true,
      changed: true,
      goal: {
        objective: "Build and verify the app",
        status: "active",
        createdAt: 100,
        updatedAt: 200,
      },
    });

    now = 300;
    expect(store.pause("task-a")).toMatchObject({
      ok: true,
      changed: true,
      goal: { status: "paused", updatedAt: 300 },
    });
    expect(store.pause("task-a")).toMatchObject({
      ok: true,
      changed: false,
      goal: { status: "paused", updatedAt: 300 },
    });

    now = 400;
    expect(store.resume("task-a")).toMatchObject({
      ok: true,
      changed: true,
      goal: { status: "active", updatedAt: 400 },
    });
    expect(store.resume("task-a")).toMatchObject({
      ok: true,
      changed: false,
      goal: { status: "active", updatedAt: 400 },
    });

    expect(store.clear("task-a")).toEqual({
      ok: true,
      goal: null,
      changed: true,
    });
    expect(store.view("task-a")).toEqual({
      ok: true,
      goal: null,
      changed: false,
    });
  });

  it("executes parsed commands against the store", () => {
    const store = new TaskGoalStore(createMemoryStorage(), { now: () => 42 });
    const parsed = parseGoalCommand("/goal Ship the composer");
    expect(parsed.kind).toBe("command");
    if (parsed.kind !== "command") throw new Error("Expected command");

    expect(executeGoalCommand(store, "task-a", parsed.command)).toMatchObject({
      ok: true,
      goal: { objective: "Ship the composer" },
    });
  });

  it("rejects empty and overlong objectives without mutating storage", () => {
    const storage = createMemoryStorage();
    const store = new TaskGoalStore(storage);

    expect(store.set("task-a", "   ")).toMatchObject({
      ok: false,
      error: "empty_objective",
    });
    expect(
      store.set("task-a", "x".repeat(GOAL_OBJECTIVE_MAX_LENGTH + 1)),
    ).toMatchObject({ ok: false, error: "objective_too_long" });
    expect(storage.entries.size).toBe(0);
  });

  it("requires an existing goal for edit, pause, and resume", () => {
    const store = new TaskGoalStore(createMemoryStorage());

    expect(store.edit("missing", "New objective")).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(store.pause("missing")).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(store.resume("missing")).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });

  it("isolates persisted goals by task id", () => {
    const storage = createMemoryStorage();
    const store = new TaskGoalStore(storage, { now: () => 10 });

    store.set("task/a", "First task");
    store.set("task%2Fa", "Second task");

    expect(store.view("task/a")).toMatchObject({
      ok: true,
      goal: { objective: "First task" },
    });
    expect(store.view("task%2Fa")).toMatchObject({
      ok: true,
      goal: { objective: "Second task" },
    });
    expect(getGoalStorageKey("task/a")).not.toBe(getGoalStorageKey("task%2Fa"));
  });

  it("treats corrupt, incompatible, and cross-task storage as absent without deleting future data", () => {
    const storage = createMemoryStorage();
    const store = new TaskGoalStore(storage);
    const key = getGoalStorageKey("task-a");
    expect(key).not.toBeNull();
    if (!key) throw new Error("Expected storage key");

    for (const raw of [
      "{bad json",
      JSON.stringify({ version: 99, objective: "Old", status: "active" }),
      JSON.stringify({
        version: 1,
        taskId: "task-b",
        objective: "Wrong task",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    ]) {
      storage.entries.set(key, raw);
      expect(store.view("task-a")).toEqual({
        ok: true,
        goal: null,
        changed: false,
      });
      expect(storage.entries.get(key)).toBe(raw);
    }
  });

  it("migrates a validated version-less record and rejects invalid timestamps", () => {
    expect(
      deserializeTaskGoal(
        JSON.stringify({
          objective: "Legacy objective",
          status: "paused",
          timestamp: 25,
        }),
        "task-a",
      ),
    ).toEqual({
      version: 1,
      taskId: "task-a",
      objective: "Legacy objective",
      status: "paused",
      createdAt: 25,
      updatedAt: 25,
    });

    expect(
      deserializeTaskGoal(
        JSON.stringify({
          objective: "Invalid",
          status: "active",
          createdAt: 50,
          updatedAt: 40,
        }),
        "task-a",
      ),
    ).toBeNull();
  });

  it("returns safe errors when storage throws", () => {
    const throwingStorage: GoalStorageAdapter = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const store = new TaskGoalStore(throwingStorage);

    expect(store.view("task-a")).toMatchObject({
      ok: false,
      error: "storage_unavailable",
    });
    expect(store.set("task-a", "Objective")).toMatchObject({
      ok: false,
      error: "storage_unavailable",
    });
    expect(store.clear("task-a")).toMatchObject({
      ok: false,
      error: "storage_unavailable",
    });
  });

  it("rejects blank task identifiers", () => {
    const store = new TaskGoalStore(createMemoryStorage());
    expect(store.set("  ", "Objective")).toMatchObject({
      ok: false,
      error: "invalid_task_id",
    });
  });
});

describe("createBrowserLocalStorageAdapter", () => {
  it("resolves browser storage lazily and delegates operations", () => {
    const storage = createMemoryStorage();
    let providerCalls = 0;
    const adapter = createBrowserLocalStorageAdapter(() => {
      providerCalls += 1;
      return storage;
    });

    expect(providerCalls).toBe(0);
    adapter.setItem("key", "value");
    expect(adapter.getItem("key")).toBe("value");
    adapter.removeItem("key");
    expect(adapter.getItem("key")).toBeNull();
    expect(providerCalls).toBe(4);
  });

  it("is safe to construct when browser storage is unavailable", () => {
    const adapter = createBrowserLocalStorageAdapter(() => null);
    expect(adapter.getItem("key")).toBeNull();
    expect(() => adapter.setItem("key", "value")).toThrow(
      "Browser storage is unavailable.",
    );
    expect(() => adapter.removeItem("key")).toThrow(
      "Browser storage is unavailable.",
    );
  });
});
