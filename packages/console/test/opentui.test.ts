import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { createTestRenderer } from "@opentui/core/testing";
import { mountRiftTui } from "../src/opentui";
import { snapshot } from "./fixture.cjs";
import { RIFT_WORDMARK, RIFT_COMPACT_LOGO } from "../src/terminal-art";
import { RIFT_ACTIVITY_MARK } from "../src/activity-orb";

test("OpenTUI input is local, submit is once and streaming retains the draft", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const events = new EventEmitter();
  const state = snapshot();
  state.approvals = [];
  const commands: unknown[] = [];
  let closes = 0;
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp/rift-test",
    connect: async () =>
      ({
        events,
        snapshot: state,
        connected: true,
        close: async () => {
          closes++;
        },
        send: async (c: unknown) => {
          commands.push(c);
        },
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("merhaba");
    expect(app.input.plainText).toBe("merhaba");
    expect(commands).toHaveLength(0);
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(commands).toEqual([
      { type: "submit", text: "merhaba", chatId: "chat-one" },
    ]);
    await ui.mockInput.typeText("next draft");
    state.entries = [
      { id: "reply", kind: "assistant", text: "Hello from the worker" },
    ];
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Hello from the worker");
    expect(app.input.plainText).toBe("next draft");
    ui.resize(48, 24);
    await ui.flush();
    expect(app.input.plainText).toBe("next draft");
  } finally {
    await app.close();
  }
  expect(closes).toBe(1);
});
test("approval is not accepted by opening or dismissing its menu", async () => {
  const ui = await createTestRenderer({ width: 80, height: 30 });
  const state = snapshot();
  const commands: unknown[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {},
        send: async (c: unknown) => {
          commands.push(c);
        },
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Review");
    ui.mockInput.pressEscape();
    await ui.flush();
    expect(commands).toHaveLength(0);
    await app.submit("/approve");
    await ui.flush();
    ui.mockInput.pressEnter();
    await ui.flush();
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(commands).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("slash opens and filters commands locally without sending a task", async () => {
  const ui = await createTestRenderer({ width: 100, height: 32 });
  const state = snapshot();
  state.approvals = [];
  state.entries = [];
  const commands: unknown[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        send: async (c: unknown) => {
          commands.push(c);
        },
        close: async () => {},
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("/");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Commands");
    expect(app.input.plainText).toBe("/");
    await ui.mockInput.typeText("eff");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("/effort");
    expect(commands).toHaveLength(0);
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("RIFT intensity");
    expect(commands).toHaveLength(0);
    ui.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await ui.flush();
    await ui.mockInput.typeText("new draft");
    await ui.flush();
    expect(app.input.plainText).toBe("new draft");
    ui.resize(48, 24);
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Recursive Intelligence");
  } finally {
    await app.close();
  }
});

test("execution switching requires confirmation and is blocked during work", async () => {
  const ui = await createTestRenderer({ width: 100, height: 36 });
  const state = snapshot();
  state.approvals = [];
  state.entries = [];
  const targets: unknown[] = [];
  let closes = 0;
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async (target) => {
      targets.push(target);
      return {
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {
          closes++;
        },
        send: async () => {},
      } as any;
    },
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    state.status = "streaming";
    await app.submit("/cloud");
    await ui.flush();
    expect(targets).toHaveLength(1);
    expect(ui.captureCharFrame()).toContain("Finish or stop");
    state.status = "ready";
    await app.submit("/cloud");
    await ui.flush();
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(targets).toHaveLength(1);
    await app.submit("/cloud");
    await ui.flush();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(targets).toEqual([undefined, "cloud"]);
    expect(closes).toBe(1);
  } finally {
    await app.close();
  }
});

test("reasoning mark pulses without changing its silhouette or disturbing the draft", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const state = snapshot();
  state.approvals = [];
  state.status = "streaming";
  state.entries = [
    {
      id: "turn:reasoning",
      kind: "activity",
      text: "Checking the supplied request.",
    },
  ];
  const events = new EventEmitter();
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events,
        snapshot: state,
        close: async () => {},
        send: async () => {},
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("keep my draft");
    await ui.flush();
    const first = ui.captureCharFrame();
    const captureColors = () =>
      JSON.stringify(
        ui
          .captureSpans()
          .lines.map((line) => line.spans.map((span) => span.fg.toInts())),
      );
    const firstColors = captureColors();
    expect(first).toContain("Checking the supplied request.");
    for (const row of RIFT_ACTIVITY_MARK) expect(first).toContain(row);
    expect(first).toContain("Reasoning");
    await new Promise((r) => setTimeout(r, 180));
    await ui.flush();
    expect(ui.captureCharFrame()).toBe(first);
    expect(captureColors()).not.toBe(firstColors);
    expect(app.input.plainText).toBe("keep my draft");
    ui.resize(36, 20);
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Reasoning");
    expect(app.input.plainText).toBe("keep my draft");
    state.status = "ready";
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).not.toContain(RIFT_ACTIVITY_MARK[1]);
  } finally {
    await app.close();
  }
});

test("welcome uses the approved lockup and a compact symbol after narrow resize", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const state = { ...snapshot(), entries: [], approvals: [] };
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {},
        send: async () => {},
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    for (const row of RIFT_WORDMARK.filter((line) => line.trim()))
      expect(ui.captureCharFrame()).toContain(row);
    expect(ui.captureCharFrame()).not.toContain("██████╗");
    await ui.mockInput.typeText("preserved draft");
    ui.resize(32, 24);
    await ui.flush();
    for (const row of RIFT_COMPACT_LOGO)
      expect(ui.captureCharFrame()).toContain(row);
    expect(ui.captureCharFrame()).not.toContain("▰▰");
    expect(app.input.plainText).toBe("preserved draft");
  } finally {
    await app.close();
  }
});

test("reduced motion keeps the activity mark still while retaining status and input", async () => {
  const previous = process.env.RIFT_REDUCED_MOTION;
  process.env.RIFT_REDUCED_MOTION = "1";
  const ui = await createTestRenderer({ width: 48, height: 24 });
  const state = {
    ...snapshot(),
    status: "streaming",
    approvals: [],
    entries: [{ id: "reply", kind: "assistant", text: "Preparing" }],
  };
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {},
        send: async () => {},
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("still editable");
    await ui.flush();
    const first = JSON.stringify(ui.captureSpans());
    await new Promise((resolve) => setTimeout(resolve, 180));
    await ui.flush();
    expect(JSON.stringify(ui.captureSpans())).toBe(first);
    expect(ui.captureCharFrame()).toContain("Working");
    expect(app.input.plainText).toBe("still editable");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.RIFT_REDUCED_MOTION;
    else process.env.RIFT_REDUCED_MOTION = previous;
  }
});

test("effort arrows only preview until Enter applies", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const state = snapshot();
  state.approvals = [];
  state.status = "ready";
  state.efforts = [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
    { value: "max", label: "Max" },
  ];
  state.effort = "low";
  const commands: any[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {},
        send: async (c) => {
          commands.push(c);
        },
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await app.submit("/effort");
    await ui.flush();
    ui.mockInput.pressArrow("right");
    await ui.flush();
    expect(commands).toHaveLength(0);
    expect(ui.captureCharFrame()).toContain("High");
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(commands).toEqual([{ type: "set-effort", value: "high" }]);
  } finally {
    await app.close();
  }
});
test("question selection is reviewed before sending and preserves the draft", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const state = snapshot();
  state.approvals = [];
  state.status = "ready";
  const events = new EventEmitter();
  const commands: any[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events,
        snapshot: state,
        close: async () => {},
        send: async (c) => commands.push(c),
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("next task");
    state.questions = [
      { id: "q1", title: "Choose the output", options: ["Web", "CLI"] },
    ];
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Choose the output");
    expect(commands).toHaveLength(0);
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Send this answer?");
    expect(commands).toHaveLength(0);
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(commands).toEqual([
      { type: "answer", id: "q1", chatId: "chat-one", text: "CLI" },
    ]);
    expect(app.input.plainText).toBe("next task");
  } finally {
    await app.close();
  }
});

test("a custom question answer preserves the original composer draft", async () => {
  const ui = await createTestRenderer({
    width: 100,
    height: 34,
    exitOnCtrlC: false,
  });
  const state = snapshot();
  state.approvals = [];
  state.status = "ready";
  const events = new EventEmitter();
  const commands: any[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events,
        snapshot: state,
        close: async () => {},
        send: async (c) => {
          commands.push(c);
          state.questions = [];
          events.emit("snapshot");
        },
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    await ui.mockInput.typeText("original draft");
    state.questions = [
      { id: "q", title: "Which output?", options: ["A", "B"] },
    ];
    events.emit("snapshot");
    await ui.flush();
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressArrow("down");
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(app.input.plainText).toBe("");
    await ui.mockInput.typeText("My own direction");
    ui.mockInput.pressEnter();
    await ui.flush();
    expect(commands).toEqual([
      { type: "answer", id: "q", chatId: "chat-one", text: "My own direction" },
    ]);
    expect(app.input.plainText).toBe("original draft");
  } finally {
    await app.close();
  }
});

test("Ctrl+C exits while idle even with a draft or an open menu", async () => {
  for (const openMenu of [false, true]) {
    const ui = await createTestRenderer({
      width: 100,
      height: 34,
      exitOnCtrlC: false,
    });
    const state = snapshot();
    state.status = "ready";
    state.approvals = [];
    let closes = 0;
    const app = mountRiftTui(ui.renderer, {
      cwd: "/tmp",
      connect: async () =>
        ({
          events: new EventEmitter(),
          snapshot: state,
          close: async () => {
            closes++;
          },
          send: async () => {},
        }) as any,
      login: async () => {},
      openApp: async () => {},
    });
    try {
      await ui.flush();
      await ui.mockInput.typeText("unsent draft");
      if (openMenu) await app.submit("/model");
      ui.mockInput.pressKey("c", { ctrl: true });
      await new Promise((r) => setTimeout(r, 100));
      expect(closes).toBe(1);
    } finally {
      await app.close();
    }
  }
});
test("Ctrl+C stops once during work; a second press exits even before Stop settles", async () => {
  const ui = await createTestRenderer({
    width: 100,
    height: 34,
    exitOnCtrlC: false,
  });
  const state = snapshot();
  state.status = "streaming";
  state.approvals = [];
  let closes = 0;
  const commands: any[] = [];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp",
    connect: async () =>
      ({
        events: new EventEmitter(),
        snapshot: state,
        close: async () => {
          closes++;
        },
        send: async (c) => {
          commands.push(c);
        },
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    ui.mockInput.pressKey("c", { ctrl: true });
    await ui.flush();
    expect(commands).toEqual([{ type: "stop", chatId: "chat-one" }]);
    expect(closes).toBe(0);
    ui.mockInput.pressKey("c", { ctrl: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(closes).toBe(1);
    expect(commands).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("streaming cache tracks mutable entries, detail toggles and removed history", async () => {
  const ui = await createTestRenderer({ width: 100, height: 34 });
  const events = new EventEmitter();
  const state = snapshot();
  state.approvals = [];
  state.status = "ready";
  const entry = {
    id: "reply",
    kind: "assistant",
    text: "First answer",
    details: "Hidden evidence",
  };
  state.entries = [entry];
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp/rift-test",
    connect: async () =>
      ({
        events,
        snapshot: state,
        close: async () => {},
        send: async () => {},
      }) as any,
    login: async () => {},
    openApp: async () => {},
  });
  try {
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("First answer");
    expect(ui.captureCharFrame()).not.toContain("Hidden evidence");
    entry.text = "Updated answer";
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Updated answer");
    expect(ui.captureCharFrame()).not.toContain("First answer");
    await app.submit("/details");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("Hidden evidence");
    entry.details = "New evidence";
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).toContain("New evidence");
    expect(ui.captureCharFrame()).not.toContain("Hidden evidence");
    state.entries = [];
    events.emit("snapshot");
    await ui.flush();
    expect(ui.captureCharFrame()).not.toContain("Updated answer");
  } finally {
    await app.close();
  }
});
