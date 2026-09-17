import { act, renderHook, waitFor } from "@testing-library/react";
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

describe("GlobalState Media Studio execution mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("starts a new Studio session in Agent when the retained model is video", async () => {
    window.localStorage.setItem("selected_model", "video-kling");
    window.localStorage.setItem("chat_mode", "ask");

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => result.current.initializeNewChat("image"));

    await waitFor(() => {
      expect(result.current.chatPurpose).toBe("image");
      expect(result.current.selectedModel).toBe("video-kling");
      expect(result.current.chatMode).toBe("agent");
    });
  });

  it("repairs a persisted video/Ask pairing on an existing Studio route", async () => {
    window.history.replaceState({}, "", "/studio?purpose=image");
    window.localStorage.setItem("selected_model", "video-veo-fast");
    window.localStorage.setItem("chat_mode", "ask");

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    await waitFor(() => {
      expect(result.current.chatPurpose).toBe("image");
      expect(result.current.selectedModel).toBe("video-veo-fast");
      expect(result.current.chatMode).toBe("agent");
    });
  });

  it("replaces a retained Build model when opening a new Studio session", async () => {
    window.localStorage.setItem("selected_model", "build-codex");
    window.localStorage.setItem("chat_mode", "agent");

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => result.current.initializeNewChat("image"));

    await waitFor(() => {
      expect(result.current.chatPurpose).toBe("image");
      expect(result.current.selectedModel).toBe("image-gemini");
      expect(result.current.chatMode).toBe("ask");
    });
  });

  it("repairs a retained non-media model on an existing Studio route", async () => {
    window.history.replaceState({}, "", "/studio?purpose=image");
    window.localStorage.setItem("selected_model", "rift-pro");
    window.localStorage.setItem("chat_mode", "agent");

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    await waitFor(() => {
      expect(result.current.chatPurpose).toBe("image");
      expect(result.current.selectedModel).toBe("image-gemini");
      expect(result.current.chatMode).toBe("ask");
    });
  });

  it("restores and updates reasoning strength independently per Build model", async () => {
    window.localStorage.setItem("selected_model", "build-codex");
    window.localStorage.setItem(
      "build_reasoning_efforts",
      JSON.stringify({
        "build-codex": "xhigh",
        "build-grok": "low",
        "build-kimi": "max",
        "build-qwen": "on",
      }),
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });
    expect(result.current.reasoningEffort).toBe("xhigh");

    act(() => result.current.setSelectedModel("build-grok"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("low"));

    act(() => result.current.setReasoningEffort("medium"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("medium"));

    act(() => result.current.setSelectedModel("build-codex"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("xhigh"));

    act(() => result.current.setSelectedModel("build-kimi"));
    act(() => result.current.setReasoningEffort("low"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("low"));

    act(() => result.current.setReasoningEffort("medium"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("max"));

    act(() => result.current.setSelectedModel("build-qwen"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("on"));

    act(() => result.current.setReasoningEffort("off"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("off"));

    act(() => result.current.setReasoningEffort("high"));
    await waitFor(() => expect(result.current.reasoningEffort).toBe("on"));
  });
});
