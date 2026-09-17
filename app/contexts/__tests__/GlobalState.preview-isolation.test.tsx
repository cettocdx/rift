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

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}

describe("build preview conversation isolation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("clears the prior preview when selecting another conversation", () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setBuildPreviewUrl("https://old-preview.example");
      result.current.setBuildPreviewOpen(true);
    });

    act(() => result.current.initializeChat("next-chat"));

    expect(result.current.buildPreviewOpen).toBe(false);
    expect(result.current.buildPreviewUrl).toBeNull();
  });

  it("clears the prior preview when starting a new conversation", () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setBuildPreviewUrl("https://old-preview.example");
      result.current.setBuildPreviewOpen(true);
    });

    act(() => result.current.initializeNewChat("app"));

    expect(result.current.buildPreviewOpen).toBe(false);
    expect(result.current.buildPreviewUrl).toBeNull();
  });
});
