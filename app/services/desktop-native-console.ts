import {
  NativeConsoleClient,
  type NativeConfig,
  type NativeMessage,
} from "@/packages/console/src/native-client";
import {
  requireDesktopTerminalOwner,
  isCurrentDesktopTerminalOwner,
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT,
  type DesktopTerminalOwner,
} from "./desktop-terminal-owner";
export type NativeOpen = {
  sessionId: string;
  workspace: string;
  workspaceKey: string;
  config: NativeConfig;
};
type Poll = {
  events: { sequence: number; message: NativeMessage }[];
  ready: boolean;
  closed: boolean;
  firstSequence: number;
  approvals: NativeMessage[];
};
async function invokeNative<T>(
  owner: DesktopTerminalOwner,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  const { invoke } = await import("@tauri-apps/api/core");
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  const result = await invoke<T>(method, { ...args, ...owner });
  if (!isCurrentDesktopTerminalOwner(owner))
    throw new Error("Desktop terminal ownership changed.");
  return result;
}
const NEW_CHAT_MARKER = "rift:native:new-conversation:v1";
const clients = new Map<string, Promise<NativeConsoleClient>>();
const sessions = new Map<
  string,
  {
    owner: DesktopTerminalOwner;
    sessionId: string;
    storageKey: string;
    dispose: () => void;
    failure?: unknown;
  }
>();
let observing = false;
/** Explicit user action only. Stops native work while preserving the saved thread for explicit resume. */
export async function disconnectDesktopNativeConsole(
  grantId: string,
): Promise<void> {
  const owner = await requireDesktopTerminalOwner();
  const key = JSON.stringify([owner.ownerId, owner.ownerGeneration, grantId]);
  // An in-flight open may own a process even though no client was returned yet.
  await clients.get(key)?.catch(() => {});
  const session = sessions.get(key);
  if (!session) return;
  await invokeNative(owner, "native_codex_close", {
    sessionId: session.sessionId,
  });
  session.dispose();
  sessions.delete(key);
  clients.delete(key);
}

export async function getDesktopNativeConsole(
  grantId: string,
): Promise<NativeConsoleClient> {
  const owner = await requireDesktopTerminalOwner();
  if (!observing && typeof window !== "undefined") {
    observing = true;
    window.addEventListener(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT, () => {
      for (const client of clients.values())
        void client.then(
          (c) => c.dispose(),
          () => {},
        );
      clients.clear();
      sessions.clear();
    });
  }
  const key = JSON.stringify([owner.ownerId, owner.ownerGeneration, grantId]);
  if (sessions.get(key)?.failure)
    throw new Error(
      "Native session requires recovery. Choose Disconnect to stop its work before reconnecting to saved history.",
    );
  const existing = clients.get(key);
  if (existing) return existing;
  const opening = (async () => {
    const opened = await invokeNative<NativeOpen>(owner, "native_codex_open", {
      grantId,
    });
    const storageKey = `rift:native-thread:${JSON.stringify([owner.ownerId, opened.workspaceKey])}`;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {}
    const resetRequested = saved === NEW_CHAT_MARKER;
    if (resetRequested) saved = null;
    let after = 0,
      stopped = false,
      ready = false,
      first = true,
      restored = false;
    const client = new NativeConsoleClient({
      config: opened.config,
      adoptReplayThread: !resetRequested,
      workspace: opened.workspace,
      send: (message) =>
        invokeNative(owner, "native_codex_send", {
          sessionId: opened.sessionId,
          message,
        }),
      persist: (id) => {
        saved = id;
        try {
          if (id) localStorage.setItem(storageKey, id);
          else localStorage.setItem(storageKey, NEW_CHAT_MARKER);
        } catch {}
      },
    });
    if (saved) client.snapshot.chatId = saved;
    let failure: unknown;
    const originalFail = client.fail.bind(client);
    client.fail = (error) => {
      failure = error;
      const session = sessions.get(key);
      if (session) session.failure = error;
      stopped = true;
      clients.delete(key);
      originalFail(error);
    };
    const originalDispose = client.dispose.bind(client);
    client.dispose = () => {
      stopped = true;
      originalDispose();
    };
    sessions.set(key, {
      owner,
      sessionId: opened.sessionId,
      storageKey,
      dispose: () => client.dispose(),
    });
    // Drain retained events before deciding whether to resume; never replay user input.
    const poll = async () => {
      if (stopped) return;
      try {
        const result = await invokeNative<Poll>(owner, "native_codex_poll", {
          sessionId: opened.sessionId,
          after,
        });
        if (result.closed)
          throw new Error(
            "Native process ended. Reconnect to inspect saved history; previous input will not be resent.",
          );
        if (result.firstSequence > after + 1) {
          throw new Error(
            `Native event history has a gap${saved ? ` for thread ${saved}` : " with no saved thread"}. Execution and tool writes may have continued. Commands are blocked. Choose Disconnect, then reconnect to inspect saved history before starting another task; inspect the workspace before repeating any input.`,
          );
        }
        for (const event of result.events) {
          if (event.sequence <= after) continue;
          client.receive(event.message);
          after = event.sequence;
        }
        ready = result.ready;
        if (ready && result.events.length < 200) {
          client.reconcileRequests(result.approvals);
          if (first) {
            first = false;
            if (saved) {
              void client
                .rpc(
                  client.snapshot.status === "streaming"
                    ? "thread/read"
                    : "thread/resume",
                  client.snapshot.status === "streaming"
                    ? { threadId: saved, includeTurns: true }
                    : { threadId: saved, model: opened.config.defaultModel },
                  (r) => {
                    client.restore(r.thread);
                    restored = true;
                  },
                )
                .catch((e) => client.fail(e));
            } else restored = true;
          }
        }
      } catch (error) {
        stopped = true;
        clients.delete(key);
        client.fail(error);
        return;
      }
      if (!stopped) setTimeout(() => void poll(), 150);
    };
    // Wait for initialized native readiness before the UI can send requests.
    const waitReady = async () => {
      const deadline = Date.now() + 30_000;
      while ((!ready || !restored) && !stopped && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!ready || !restored || stopped) {
        if (failure) throw failure;
        client.fail(
          new Error(
            "Native console readiness timed out. Reconnect to inspect saved history.",
          ),
        );
        throw new Error(
          "Native console could not become ready. Check desktop setup and reconnect.",
        );
      }
    };
    void poll();
    await waitReady();
    return client;
  })();
  clients.set(key, opening);
  void opening.catch(() => {
    if (clients.get(key) === opening) clients.delete(key);
  });
  return opening;
}
