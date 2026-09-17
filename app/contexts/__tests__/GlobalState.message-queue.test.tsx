import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";

jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(async () => undefined),
  useQuery: () => undefined,
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    isAuthenticated: false,
    entitlements: [],
    entitlementsReady: true,
  }),
}));

jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}

describe("conversation-owned message queues", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("requires an explicit chat binding before queued messages can be consumed", () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });
    expect(result.current).toHaveProperty("activeQueueChatId", null);
    expect(result.current).toHaveProperty(
      "setActiveQueueChat",
      expect.any(Function),
    );
    expect(result.current.messageQueue).toEqual([]);
  });

  it("starting a new chat retains queued work for the conversation left behind", () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });
    act(() => result.current.setActiveQueueChat("running-chat"));
    act(() => result.current.queueMessage("Run the accessibility check next"));
    const queued = result.current.messageQueue[0];
    act(() => result.current.initializeNewChat("app"));
    expect(result.current.activeQueueChatId).toBeNull();
    expect(result.current.messageQueue).toEqual([]);
    act(() => result.current.setActiveQueueChat("running-chat"));
    expect(result.current.messageQueue).toEqual([queued]);
  });
});
