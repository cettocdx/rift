import { act, renderHook } from "@testing-library/react";
import { useNativeConsoleRuntime } from "../useNativeConsoleRuntime";
import {
  getDesktopNativeConsole,
  disconnectDesktopNativeConsole,
} from "@/app/services/desktop-native-console";
import { nativeSnapshot } from "@/packages/console/src/native-client";
jest.mock("@/app/services/desktop-native-console", () => ({
  getDesktopNativeConsole: jest.fn(),
  disconnectDesktopNativeConsole: jest.fn(),
}));
jest.mock("@/app/services/desktop-terminal-owner", () => ({
  DESKTOP_TERMINAL_OWNER_CHANGED_EVENT: "native-owner-changed",
}));
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client() {
  let notify = () => {};
  const unsubscribe = jest.fn();
  const value = {
    snapshot: { ...nativeSnapshot("OLD OWNER SECRET"), status: "ready" },
    subscribe: jest.fn((cb: () => void) => {
      notify = cb;
      return unsubscribe;
    }),
    command: jest.fn(async () => ({ accepted: true })),
  };
  return { value, unsubscribe, notify: () => notify() };
}
function changeOwner() {
  window.dispatchEvent(new Event("native-owner-changed"));
}
beforeEach(() => jest.clearAllMocks());
test.each(["resolve", "reject"])(
  "owner epoch rejects an old opening %s",
  async (kind) => {
    const opening = deferred();
    (getDesktopNativeConsole as jest.Mock).mockReturnValue(opening.promise);
    const { result } = renderHook(() => useNativeConsoleRuntime("grant"));
    await act(async () => {
      changeOwner();
      if (kind === "resolve") opening.resolve(client().value);
      else opening.reject(new Error("OLD OWNER SECRET"));
      await opening.promise.catch(() => {});
    });
    expect(JSON.stringify(result.current.snapshot)).not.toContain(
      "OLD OWNER SECRET",
    );
    expect(result.current.snapshot.status).toBe("unavailable");
  },
);
test("owner change unsubscribes synchronously and stale disposal publication cannot restore transcript", async () => {
  const old = client();
  (getDesktopNativeConsole as jest.Mock).mockResolvedValue(old.value);
  const { result } = renderHook(() => useNativeConsoleRuntime("grant"));
  await act(async () => {});
  expect(JSON.stringify(result.current.snapshot)).toContain("OLD OWNER SECRET");
  const oldCommand = result.current.onCommand;
  await act(async () => {
    changeOwner();
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    old.notify();
  });
  expect(JSON.stringify(result.current.snapshot)).not.toContain(
    "OLD OWNER SECRET",
  );
  expect((await oldCommand({ type: "new-chat" })).accepted).toBe(false);
  expect(old.value.command).not.toHaveBeenCalled();
});
test.each(["resolve", "reject"])(
  "owner epoch rejects an old disconnect %s",
  async (kind) => {
    const old = client();
    const closing = deferred();
    (getDesktopNativeConsole as jest.Mock).mockResolvedValue(old.value);
    (disconnectDesktopNativeConsole as jest.Mock).mockReturnValue(
      closing.promise,
    );
    const { result } = renderHook(() => useNativeConsoleRuntime("grant"));
    await act(async () => {});
    await act(async () => {
      const pending = result.current.disconnect();
      changeOwner();
      if (kind === "resolve") closing.resolve(undefined);
      else closing.reject(new Error("OLD OWNER SECRET"));
      await pending;
    });
    expect(JSON.stringify(result.current.snapshot)).not.toContain(
      "OLD OWNER SECRET",
    );
    expect(JSON.stringify(result.current.snapshot)).not.toContain(
      "Disconnected. Saved",
    );
    expect(JSON.stringify(result.current.snapshot)).toContain("Sign in");
  },
);
