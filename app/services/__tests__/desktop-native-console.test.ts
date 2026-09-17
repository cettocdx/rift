import { getDesktopNativeConsole } from "../desktop-native-console";
import {
  requireDesktopTerminalOwner,
  isCurrentDesktopTerminalOwner,
} from "../desktop-terminal-owner";
import { invoke } from "@tauri-apps/api/core";
jest.mock("../desktop-terminal-owner", () => ({
  requireDesktopTerminalOwner: jest.fn(),
  isCurrentDesktopTerminalOwner: jest.fn(),
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT: "owner-change",
}));
jest.mock("@tauri-apps/api/core", () => ({ invoke: jest.fn() }));
const owner = { ownerId: "account", ownerGeneration: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (requireDesktopTerminalOwner as jest.Mock).mockResolvedValue(owner);
  (isCurrentDesktopTerminalOwner as jest.Mock).mockReturnValue(true);
});
afterEach(() => window.dispatchEvent(new Event("owner-change")));
test("retains one native process and snapshot across detach/reattach; owner switch invalidates client", async () => {
  (invoke as jest.Mock).mockImplementation(async (command: string) => {
    if (command === "native_codex_open")
      return {
        sessionId: "session",
        workspace: "/work",
        workspaceKey: "work",
        config: {
          defaultModel: "gpt",
          models: [
            {
              id: "gpt",
              label: "GPT",
              providerModel: "gpt",
              efforts: ["medium"],
            },
          ],
        },
      };
    if (command === "native_codex_poll")
      return {
        events: [],
        ready: true,
        closed: false,
        firstSequence: 1,
        approvals: [],
      };
  });
  const [a, b] = await Promise.all([
    getDesktopNativeConsole("grant"),
    getDesktopNativeConsole("grant"),
  ]);
  expect(a).toBe(b);
  const off = a.subscribe(() => {});
  off();
  expect(await getDesktopNativeConsole("grant")).toBe(a);
  expect(
    (invoke as jest.Mock).mock.calls.filter(
      (c) => c[0] === "native_codex_open",
    ),
  ).toHaveLength(1);
  window.dispatchEvent(new Event("owner-change"));
  await Promise.resolve();
  expect(
    (
      await a.command({
        type: "submit",
        text: "old account task",
        chatId: null,
      })
    ).accepted,
  ).toBe(false);
  expect(
    (invoke as jest.Mock).mock.calls.some((c) => c[0] === "native_codex_send"),
  ).toBe(false);
});
test("native setup error propagates without cloud fallback", async () => {
  (invoke as jest.Mock).mockRejectedValue(
    new Error("Install the pinned native binary."),
  );
  await expect(getDesktopNativeConsole("failure-grant")).rejects.toThrow(
    "Install the pinned native binary.",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("native_codex_open", {
    ...owner,
    grantId: "failure-grant",
  });
});
test("stale owner rejected before native IPC", async () => {
  (isCurrentDesktopTerminalOwner as jest.Mock).mockReturnValue(false);
  await expect(getDesktopNativeConsole("other-grant")).rejects.toThrow(
    "ownership changed",
  );
  expect(invoke).not.toHaveBeenCalled();
});

const pause = () => new Promise((r) => setTimeout(r, 30));
async function until(check: () => boolean) {
  for (let i = 0; i < 60; i++) {
    if (check()) return;
    await pause();
  }
  throw new Error("Timed out waiting for native state");
}
function nativeHarness() {
  let sequence = 0;
  let gap = false;
  let thread = 0;
  let opens = 0;
  const queue: any[] = [];
  const sent: any[] = [];
  const emit = (message: any) => queue.push({ sequence: ++sequence, message });
  const storageKey =
    "rift:native-thread:" + JSON.stringify(["account", "work"]);
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => `test-${++thread}`,
  });
  let restoreBatch: ((id: string) => void) | undefined;
  (invoke as jest.Mock).mockImplementation(
    async (command: string, args: any) => {
      if (command === "native_codex_open") {
        opens++;
        return {
          sessionId: `session-${opens}`,
          workspace: "/work",
          workspaceKey: "work",
          config: {
            defaultModel: "gpt",
            models: [
              {
                id: "gpt",
                label: "GPT",
                providerModel: "gpt",
                efforts: ["medium"],
              },
            ],
          },
        };
      }
      if (command === "native_codex_close") {
        queue.length = 0;
        gap = false;
        sequence = 0;
        return;
      }
      if (command === "native_codex_poll")
        return {
          events: queue.splice(0),
          ready: true,
          closed: false,
          firstSequence: gap ? sequence + 100 : 1,
          approvals: [],
        };
      if (command === "native_codex_send") {
        const m = args.message;
        sent.push(m);
        if (m.method === "thread/start")
          emit({
            id: m.id,
            result: { thread: { id: `thread-${thread}`, turns: [] } },
          });
        if (m.method === "turn/start") {
          emit({ id: m.id, result: { turn: { id: "turn" } } });
          emit({
            method: "turn/started",
            params: {
              threadId: m.params.threadId,
              turn: { id: "turn", status: "inProgress", items: [] },
            },
          });
        }
        if (m.method === "thread/resume" || m.method === "thread/read") {
          if (restoreBatch) restoreBatch(m.id);
          else
            emit({
              id: m.id,
              result: { thread: { id: m.params.threadId, turns: [] } },
            });
        }
      }
    },
  );
  return {
    emit,
    sent,
    storageKey,
    gap: () => {
      gap = true;
    },
    restore: (fn: (id: string) => void) => {
      restoreBatch = fn;
    },
    opens: () => opens,
  };
}
test.each(["ready", "first submit", "new chat"])(
  "post-initial replay gap fails closed after %s and does not resend",
  async (stage) => {
    const h = nativeHarness();
    const client = await getDesktopNativeConsole(`gap-${stage}`);
    if (stage !== "ready") {
      await client.command({ type: "submit", text: "task", chatId: null });
      if (stage === "new chat") {
        h.emit({
          method: "turn/completed",
          params: {
            threadId: client.snapshot.chatId,
            turn: { id: "turn", status: "completed" },
          },
        });
        await until(() => client.snapshot.status === "ready");
        await client.command({ type: "new-chat" });
        await client.command({
          type: "submit",
          text: "new task",
          chatId: null,
        });
      }
    }
    const current = client.snapshot.chatId;
    const submits = h.sent.filter((m) => m.method === "turn/start").length;
    h.gap();
    await until(() => client.snapshot.status === "error");
    expect(client.snapshot.entries.at(-1)?.text).toContain(
      current ?? "no saved thread",
    );
    expect(
      (await client.command({ type: "submit", text: "retry", chatId: current }))
        .accepted,
    ).toBe(false);
    expect(h.sent.filter((m) => m.method === "turn/start")).toHaveLength(
      submits,
    );
  },
);
test("history response is restored at its sequence position before newer delta and completion", async () => {
  const h = nativeHarness();
  localStorage.setItem(h.storageKey, "saved");
  h.restore((id) => {
    h.emit({
      id,
      result: {
        thread: {
          id: "saved",
          turns: [
            {
              id: "turn",
              status: "inProgress",
              items: [{ id: "answer", type: "agentMessage", text: "Before" }],
            },
          ],
        },
      },
    });
    h.emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "saved",
        turnId: "turn",
        itemId: "answer",
        delta: " after",
      },
    });
    h.emit({
      method: "turn/completed",
      params: { threadId: "saved", turn: { id: "turn", status: "completed" } },
    });
  });
  const client = await getDesktopNativeConsole("ordered");
  expect(client.snapshot.status).toBe("ready");
  expect(client.snapshot.entries.find((e) => e.id === "answer")?.text).toBe(
    "Before after",
  );
});
test.each(["item/tool/requestUserInput", "unsupported/request"])(
  "unsupported %s permits explicit native close and clean reconnect",
  async (method) => {
    const { disconnectDesktopNativeConsole } =
      await import("../desktop-native-console");
    const h = nativeHarness();
    const client = await getDesktopNativeConsole("unsupported");
    await client.command({ type: "submit", text: "task", chatId: null });
    h.emit({
      id: 900,
      method,
      params: {
        threadId: client.snapshot.chatId,
        turnId: "turn",
        questions: Array.from({ length: 4 }, (_, i) => ({
          id: String(i),
          question: "Question",
        })),
      },
    });
    await until(() => client.snapshot.status === "error");
    await expect(getDesktopNativeConsole("unsupported")).rejects.toThrow(
      "Disconnect",
    );
    expect(h.opens()).toBe(1);
    const savedThread = client.snapshot.chatId;
    await disconnectDesktopNativeConsole("unsupported");
    expect(invoke).toHaveBeenCalledWith("native_codex_close", {
      ...owner,
      sessionId: "session-1",
    });
    expect(localStorage.getItem(h.storageKey)).toBe(savedThread);
    const next = await getDesktopNativeConsole("unsupported");
    expect(next.snapshot.status).toBe("ready");
    expect(next.snapshot.chatId).toBe(savedThread);
    expect(h.sent.filter((m) => m.method === "thread/resume")).toHaveLength(1);
    expect(h.sent.filter((m) => m.method === "turn/start")).toHaveLength(1);
  },
);
test("disconnect preserves conversation and reconnect resumes it once without any turn submission", async () => {
  const { disconnectDesktopNativeConsole } =
    await import("../desktop-native-console");
  const h = nativeHarness();
  localStorage.setItem(h.storageKey, "saved-history");
  const first = await getDesktopNativeConsole("resume");
  expect(first.snapshot.chatId).toBe("saved-history");
  const resumeCount = h.sent.filter((m) => m.method === "thread/resume").length;
  await disconnectDesktopNativeConsole("resume");
  expect(localStorage.getItem(h.storageKey)).toBe("saved-history");
  const next = await getDesktopNativeConsole("resume");
  expect(next.snapshot.chatId).toBe("saved-history");
  expect(h.sent.filter((m) => m.method === "thread/resume")).toHaveLength(
    resumeCount + 1,
  );
  expect(h.sent.filter((m) => m.method === "turn/start")).toHaveLength(0);
});
test("explicit new conversation survives reattachment to the old native replay", async () => {
  const h = nativeHarness();
  const old = await getDesktopNativeConsole("reset");
  old.restore({ id: "old-thread", turns: [] });
  await old.command({ type: "new-chat" });
  expect(localStorage.getItem(h.storageKey)).toBeTruthy();
  expect(localStorage.getItem(h.storageKey)).not.toBe("old-thread");
  window.dispatchEvent(new Event("owner-change"));
  await Promise.resolve();
  h.emit({
    method: "thread/started",
    params: { thread: { id: "old-thread" } },
  });
  h.emit({
    method: "turn/started",
    params: {
      threadId: "old-thread",
      turn: { id: "old-turn", status: "inProgress", items: [] },
    },
  });
  const next = await getDesktopNativeConsole("reset");
  expect(next.snapshot.chatId).toBeNull();
  expect(h.sent.filter((m) => m.method === "thread/resume")).toHaveLength(0);
  await next.command({
    type: "submit",
    chatId: null,
    text: "genuinely new task",
  });
  expect(next.snapshot.chatId).not.toBe("old-thread");
  expect(localStorage.getItem(h.storageKey)).toBe(next.snapshot.chatId);
  expect(h.sent.filter((m) => m.method === "turn/start")).toHaveLength(1);
});
