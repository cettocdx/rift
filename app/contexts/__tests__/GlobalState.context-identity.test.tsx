import { act, render, renderHook } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";

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

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}

describe("global state context identity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("hands consumers the same value when the provider re-renders for other reasons", () => {
    // 57 non-test files read this context. While the value was a plain object
    // literal every one of them re-rendered whenever anything in the provider
    // changed, including state they do not read.
    // The assertion is on the value's identity, not on a render count: the
    // host recreates <Probe /> on every tick, so React re-renders it either
    // way. Identity is what decides whether every OTHER consumer in the app
    // re-renders, and it is what regressed.
    const seen: unknown[] = [];

    function Probe() {
      seen.push(useGlobalState());
      return null;
    }

    const bumpRef: { current: (() => void) | null } = { current: null };
    function Host() {
      const [, setTick] = useState(0);
      // Published from an effect, not during render: reassigning an outer
      // binding while rendering is the side effect the lint rule is about.
      useEffect(() => {
        bumpRef.current = () => setTick((tick) => tick + 1);
      }, []);
      return (
        <GlobalStateProvider>
          <Probe />
        </GlobalStateProvider>
      );
    }

    render(<Host />);
    // Mount settles first: effects in the provider legitimately set state, and
    // a new value then is correct. What must not change is what happens after.
    const settled = seen[seen.length - 1];
    const before = seen.length;

    act(() => bumpRef.current?.());
    act(() => bumpRef.current?.());

    const afterBumps = seen.slice(before);
    expect(afterBumps.length).toBeGreaterThan(1);
    expect(afterBumps.every((value) => value === settled)).toBe(true);
  });

  it("hands consumers a new value when state they read actually changes", () => {
    // The other half of the contract: memoising must not freeze the value.
    const { result } = renderHook(() => useGlobalState(), { wrapper });
    const before = result.current;

    act(() => result.current.setChatSidebarOpen(false));

    expect(result.current).not.toBe(before);
    expect(result.current.chatSidebarOpen).toBe(false);
  });

  it("keeps the sidebar callbacks stable across renders", () => {
    // These five were plain function declarations, so they were rebuilt on
    // every render and the memo above could never hold.
    const { result } = renderHook(() => useGlobalState(), { wrapper });
    const first = {
      clearUploadedFiles: result.current.clearUploadedFiles,
      openSidebar: result.current.openSidebar,
      updateSidebarContent: result.current.updateSidebarContent,
      closeSidebar: result.current.closeSidebar,
      toggleChatSidebar: result.current.toggleChatSidebar,
    };

    act(() => result.current.setChatSidebarOpen(false));

    expect(result.current.clearUploadedFiles).toBe(first.clearUploadedFiles);
    expect(result.current.openSidebar).toBe(first.openSidebar);
    expect(result.current.updateSidebarContent).toBe(first.updateSidebarContent);
    expect(result.current.closeSidebar).toBe(first.closeSidebar);
    expect(result.current.toggleChatSidebar).toBe(first.toggleChatSidebar);
  });
});
