import { act, renderHook, waitFor } from "@testing-library/react";
import { useSandboxPreference } from "../useSandboxPreference";
import { DESKTOP_LOCAL_ACCESS_CHANGED_EVENT } from "@/app/services/desktop-local-access";

const mockSyncTerminalOwner = jest.fn(async () => ({
  ownerId: "account-a",
  ownerGeneration: 1,
}));
jest.mock("@/app/services/desktop-terminal-owner", () => ({
  synchronizeDesktopTerminalOwner: (...args: unknown[]) =>
    mockSyncTerminalOwner(...args),
}));
const mockConnect = jest.fn();
const mockRefresh = jest.fn();
const mockDisconnect = jest.fn();
const mockListGrants = jest.fn();
const mockAccessStatus = jest.fn();
const mockRevokeDevice = jest.fn(async () => {});
const mockIsTauri = jest.fn(() => true);
const mockBridges: Array<{
  config: { onConnectionStateChange?: (ready: boolean) => void };
  start: jest.Mock;
  stop: jest.Mock;
  isReady: jest.Mock;
  getConnectionId: jest.Mock;
  canReconnect: jest.Mock;
  reconnectTransport: jest.Mock;
}> = [];
let mockStart: () => Promise<string>;
jest.mock("convex/react", () => ({
  useMutation: (key: string) =>
    key === "connect"
      ? mockConnect
      : key === "refresh"
        ? mockRefresh
        : mockDisconnect,
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    localSandbox: {
      connectDesktop: "connect",
      refreshCentrifugoTokenDesktop: "refresh",
      disconnectDesktop: "disconnect",
    },
  },
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockIsTauri(),
}));
jest.mock("@/app/services/desktop-local-access", () => ({
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT: "rift:desktop-local-access-changed",
  listDesktopWorkspaceGrants: () => mockListGrants(),
  getDesktopAccessStatus: () => mockAccessStatus(),
  disconnectDesktopCapabilities: () => mockRevokeDevice(),
}));
jest.mock("@/app/services/desktop-sandbox-bridge", () => ({
  DesktopSandboxBridge: jest.fn().mockImplementation((config) => {
    const bridge = {
      config,
      start: jest.fn(() => mockStart()),
      stop: jest.fn(async () => config.onConnectionStateChange?.(false)),
      isReady: jest.fn(() => false),
      getConnectionId: jest.fn(() => "connection"),
      canReconnect: jest.fn(() => true),
      reconnectTransport: jest.fn(() => false),
    };
    mockBridges.push(bridge);
    return bridge;
  }),
}));
const grant = { grantId: "opaque", writable: true };
const grantChange = () =>
  window.dispatchEvent(new Event(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT));
beforeEach(() => {
  jest.clearAllMocks();
  mockBridges.length = 0;
  mockStart = async () => "connection";
  mockListGrants.mockResolvedValue([grant]);
  mockAccessStatus.mockResolvedValue({ localWeb: false, computer: false });
  mockIsTauri.mockReturnValue(true);
});

it("does not call a registered but unsubscribed desktop bridge active", async () => {
  const { result } = renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.desktopBridgeActive).toBe(false);
  act(() => mockBridges[0].config.onConnectionStateChange?.(true));
  expect(result.current.desktopBridgeActive).toBe(true);
  act(() => mockBridges[0].config.onConnectionStateChange?.(false));
  expect(result.current.desktopBridgeActive).toBe(false);
});

it("keeps presence ready without grants and after permissions are revoked", async () => {
  mockListGrants.mockResolvedValue([]);
  const { result } = renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  act(() => mockBridges[0].config.onConnectionStateChange?.(true));
  await act(async () => {
    grantChange();
  });
  expect(result.current.desktopBridgeActive).toBe(true);
  expect(mockBridges[0].stop).not.toHaveBeenCalled();
  expect(mockRevokeDevice).not.toHaveBeenCalled();
});

it("retries failed startup on a subsequent grant change", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockStart = async () => {
    throw new Error("offline");
  };
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges[0]?.stop).toHaveBeenCalled());
  mockStart = async () => "connection";
  act(grantChange);
  await waitFor(() => expect(mockBridges).toHaveLength(2));
  spy.mockRestore();
});

it("clears active state on sign-out and ignores old callbacks", async () => {
  const { result, rerender } = renderHook(
    ({ authenticated }) => useSandboxPreference(authenticated),
    { initialProps: { authenticated: true } },
  );
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  act(() => mockBridges[0].config.onConnectionStateChange?.(true));
  expect(result.current.desktopBridgeActive).toBe(true);
  rerender({ authenticated: false });
  act(() => mockBridges[0].config.onConnectionStateChange?.(true));
  expect(result.current.desktopBridgeActive).toBe(false);
});

it("does not create a native relay in the browser but keeps native presence without grants", async () => {
  mockIsTauri.mockReturnValue(false);
  const first = renderHook(() => useSandboxPreference(true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockBridges).toHaveLength(0);
  first.unmount();
  mockIsTauri.mockReturnValue(true);
  mockListGrants.mockResolvedValue([]);
  renderHook(() => useSandboxPreference(true));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockBridges).toHaveLength(1);
});

it("does not let a signed-out pending relay clear a newer ready relay", async () => {
  let finishOldStart!: (id: string) => void;
  mockStart = () =>
    new Promise((resolve) => {
      finishOldStart = resolve;
    });
  const { result, rerender } = renderHook(
    ({ authenticated }) => useSandboxPreference(authenticated),
    { initialProps: { authenticated: true } },
  );
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  rerender({ authenticated: false });
  await waitFor(() => expect(mockBridges[0].stop).toHaveBeenCalled());
  mockStart = async () => "new-connection";
  rerender({ authenticated: true });
  await waitFor(() => expect(mockBridges).toHaveLength(2));
  act(() => mockBridges[1].config.onConnectionStateChange?.(true));
  await act(async () => {
    finishOldStart("old-connection");
    await Promise.resolve();
    mockBridges[0].config.onConnectionStateChange?.(false);
  });
  expect(result.current.desktopBridgeActive).toBe(true);
  expect(mockBridges[1].stop).not.toHaveBeenCalled();
});

it("preserves explicit Local preferences instead of silently changing them to Cloud", async () => {
  const { result } = renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  act(() => result.current.setSandboxPreference("desktop"));
  expect(result.current.sandboxPreference).toBe("desktop");
  mockListGrants.mockResolvedValue([]);
  act(grantChange);
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockBridges[0].stop).not.toHaveBeenCalled();
  expect(result.current.sandboxPreference).toBe("desktop");
});

it("reconnects a terminated recoverable relay on coming online without another picker interaction", async () => {
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  await act(async () => {
    await Promise.resolve();
  });
  mockBridges[0].getConnectionId.mockReturnValue(null);
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(mockBridges).toHaveLength(2));
});

it("keeps an existing reconnecting socket and does not kick it with a replacement registration", async () => {
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  await act(async () => {
    grantChange();
    await Promise.resolve();
  });
  expect(mockBridges).toHaveLength(1);
  expect(mockBridges[0].stop).not.toHaveBeenCalled();
});

it.each(["online", "focus"])(
  "offers a retained terminal socket transport recovery on %s without replacing it",
  async (event) => {
    renderHook(() => useSandboxPreference(true));
    await act(async () => {
      await Promise.resolve();
    });
    const bridge = mockBridges[0];
    bridge.reconnectTransport.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event(event)));
    expect(bridge.reconnectTransport).toHaveBeenCalledTimes(1);
    expect(mockBridges).toHaveLength(1);
    expect(bridge.stop).not.toHaveBeenCalled();
  },
);

it("offers retained terminal sockets recovery on the background timer", async () => {
  jest.useFakeTimers();
  try {
    const hook = renderHook(() => useSandboxPreference(true));
    await act(async () => {
      await Promise.resolve();
    });
    const bridge = mockBridges[0];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(bridge.reconnectTransport).toHaveBeenCalledTimes(1);
    expect(mockBridges).toHaveLength(1);
    expect(bridge.stop).not.toHaveBeenCalled();
    hook.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it("does not reclaim a connection replaced by another desktop session on focus", async () => {
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  mockBridges[0].getConnectionId.mockReturnValue(null);
  mockBridges[0].canReconnect.mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
  });
  expect(mockBridges).toHaveLength(1);
});

it("a transient native grant-list error does not revoke the live connection", async () => {
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  mockListGrants.mockRejectedValueOnce(
    new Error("temporary native IPC failure"),
  );
  await act(async () => {
    grantChange();
    await Promise.resolve();
  });
  expect(mockBridges[0].stop).not.toHaveBeenCalled();
});

it("recovers a presence timeout reported after the wake event without requiring another focus", async () => {
  jest.useFakeTimers();
  try {
    const hook = renderHook(() => useSandboxPreference(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockBridges).toHaveLength(1);
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBridges).toHaveLength(1);
    mockBridges[0].getConnectionId.mockReturnValue(null);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockBridges).toHaveLength(2);
    hook.unmount();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it.each(["localWeb", "computer"])(
  "connects Cloud to a %s grant without sharing files",
  async (capability) => {
    mockListGrants.mockResolvedValue([]);
    mockAccessStatus.mockResolvedValue({
      localWeb: false,
      computer: false,
      [capability]: true,
    });
    const { result } = renderHook(() => useSandboxPreference(true));
    await waitFor(() => expect(mockBridges).toHaveLength(1));
    expect(result.current.sandboxPreference).toBe("e2b");
    mockAccessStatus.mockResolvedValue({ localWeb: false, computer: false });
    act(grantChange);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBridges[0].stop).not.toHaveBeenCalled();
  },
);

it("keeps a live device relay on a transient status IPC failure", async () => {
  mockListGrants.mockResolvedValue([]);
  mockAccessStatus.mockResolvedValue({ localWeb: true, computer: false });
  renderHook(() => useSandboxPreference(true));
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  mockAccessStatus.mockRejectedValue(new Error("IPC temporarily unavailable"));
  await act(async () => {
    grantChange();
  });
  expect(mockBridges[0].stop).not.toHaveBeenCalled();
});

it("preserves grants while a signed-in reload resolves authentication", async () => {
  const { rerender } = renderHook(
    ({ authenticated, authReady }) =>
      useSandboxPreference(authenticated, authReady),
    { initialProps: { authenticated: false, authReady: false } },
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockRevokeDevice).not.toHaveBeenCalled();
  expect(mockBridges).toHaveLength(0);
  rerender({ authenticated: true, authReady: true });
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  expect(mockRevokeDevice).not.toHaveBeenCalled();
});

it("revokes grants only after authentication resolves to signed out", async () => {
  const { rerender } = renderHook(
    ({ authenticated, authReady }) =>
      useSandboxPreference(authenticated, authReady),
    { initialProps: { authenticated: false, authReady: false } },
  );
  expect(mockRevokeDevice).not.toHaveBeenCalled();
  rerender({ authenticated: false, authReady: true });
  expect(mockRevokeDevice).toHaveBeenCalledTimes(1);
  expect(mockBridges).toHaveLength(0);
});

it("revokes device and workspace grants on confirmed sign out", async () => {
  const { rerender } = renderHook(
    ({ authenticated, authReady }) =>
      useSandboxPreference(authenticated, authReady),
    { initialProps: { authenticated: true, authReady: true } },
  );
  await waitFor(() => expect(mockBridges).toHaveLength(1));
  rerender({ authenticated: false, authReady: false });
  expect(mockRevokeDevice).not.toHaveBeenCalled();
  expect(mockBridges[0].stop).toHaveBeenCalled();
  rerender({ authenticated: false, authReady: true });
  expect(mockRevokeDevice).toHaveBeenCalledTimes(1);
  expect(mockBridges[0].stop).toHaveBeenCalled();
});

it("does not register an unauthenticated desktop", async () => {
  renderHook(() => useSandboxPreference(false));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockBridges).toHaveLength(0);
});

it("recovers presence while the app is in the background", async () => {
  jest.useFakeTimers();
  const visibility = jest
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  try {
    const hook = renderHook(() => useSandboxPreference(true));
    await act(async () => {
      await Promise.resolve();
    });
    mockBridges[0].getConnectionId.mockReturnValue(null);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockBridges).toHaveLength(2);
    hook.unmount();
  } finally {
    visibility.mockRestore();
    jest.useRealTimers();
  }
});

it("waits for resolved account ownership and synchronizes an authenticated account switch", async () => {
  const view = renderHook(
    ({ id, ready }: { id: string; ready: boolean }) =>
      useSandboxPreference(true, ready, id),
    { initialProps: { id: "account-a", ready: false } },
  );
  expect(mockSyncTerminalOwner).not.toHaveBeenCalled();
  view.rerender({ id: "account-a", ready: true });
  await waitFor(() =>
    expect(mockSyncTerminalOwner).toHaveBeenCalledWith("account-a"),
  );
  view.rerender({ id: "account-b", ready: true });
  await waitFor(() =>
    expect(mockSyncTerminalOwner).toHaveBeenCalledWith("account-b"),
  );
});
