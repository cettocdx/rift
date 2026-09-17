import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { onChatCommand } from "@/lib/utils/chat-command-events";
import {
  openModelSelector,
  openReasoningSelector,
  requestProjectSelector,
} from "@/lib/utils/composer-controls";
import { openCommandPalette } from "@/lib/utils/command-palette";
import {
  browserTaskGoalStore,
  readTaskGoal,
} from "@/lib/composer/browser-goal-store";
import { GOAL_OBJECTIVE_MAX_LENGTH } from "@/lib/composer/goal-store";
import {
  resolveSlashModel,
  useSlashCommandRuntime,
} from "../useSlashCommandRuntime";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(() => undefined),
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

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  // GlobalState reads usePathname for its route->overlay teardown effect.
  usePathname: () => "/",
}));

jest.mock("next-themes", () => ({
  useTheme: jest.fn(),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock("@/app/components/pro/ProShortcutsDialog", () => ({
  openShortcutsDialog: jest.fn(),
}));

jest.mock("@/lib/utils/command-palette", () => ({
  openCommandPalette: jest.fn(),
}));

jest.mock("@/lib/utils/composer-controls", () => ({
  openModelSelector: jest.fn(),
  openReasoningSelector: jest.fn(),
  requestProjectSelector: jest.fn(),
}));

jest.mock("@/lib/utils/logout", () => ({ clientLogout: jest.fn() }));

const mockMutation = jest.fn(async () => undefined);
const mockSetTheme = jest.fn();
const mockGoHome = jest.fn();
const mockPush = jest.fn();
const mockToast = {
  error: jest.mocked(toast.error),
  info: jest.mocked(toast.info),
  success: jest.mocked(toast.success),
};

function StateProbe() {
  const {
    selectedModel,
    chatMode,
    reasoningEffort,
    chatPurpose,
    activeProject,
    setActiveProject,
    setChatPurpose,
  } = useGlobalState();
  return (
    <>
      <output data-testid="runtime-state">
        {selectedModel}:{chatMode}:{reasoningEffort}:{chatPurpose}:
        {activeProject?.id ?? "no-project"}
      </output>
      <button type="button" onClick={() => setChatPurpose("image")}>
        Set image purpose
      </button>
      <button
        type="button"
        onClick={() =>
          setActiveProject({ id: "project-a", name: "Project A", type: "app" })
        }
      >
        Set active project
      </button>
    </>
  );
}

function RuntimeProvider({ children }: { children: ReactNode }) {
  return (
    <GlobalStateProvider>
      {children}
      <StateProbe />
    </GlobalStateProvider>
  );
}

function createRuntimeOptions() {
  return {
    taskId: "task-runtime",
    status: "ready" as const,
    onStop: jest.fn(),
    onClearComposer: jest.fn(),
    onSetComposer: jest.fn(),
    onSubmitPrompt: jest.fn(),
  };
}

async function runCommand(
  runtime: { current: ReturnType<typeof useSlashCommandRuntime> },
  input: string,
) {
  let handled = false;
  await act(async () => {
    handled = await runtime.current.execute(input);
  });
  return handled;
}

describe("useSlashCommandRuntime", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    mockMutation.mockReset().mockResolvedValue(undefined);
    jest.mocked(useMutation).mockReturnValue(mockMutation as never);
    jest.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
      refresh: jest.fn(),
    } as never);
    jest.mocked(useTheme).mockReturnValue({
      setTheme: mockSetTheme,
      resolvedTheme: "dark",
    } as never);
    jest.mocked(useChatNavigation).mockReturnValue({
      goHome: mockGoHome,
    } as never);
    jest.mocked(openModelSelector).mockReturnValue(true);
    jest.mocked(openReasoningSelector).mockReturnValue(true);
    jest.mocked(requestProjectSelector).mockReturnValue(true);
  });

  it("sets, views, pauses, and clears a task goal", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/goal Ship the release")).toBe(true);
    expect(readTaskGoal(options.taskId)).toMatchObject({
      objective: "Ship the release",
      status: "active",
    });

    mockToast.info.mockClear();
    expect(await runCommand(result, "/goal")).toBe(true);
    expect(mockToast.info).toHaveBeenCalledWith("Active goal", {
      description: "Ship the release",
    });

    expect(await runCommand(result, "/goal pause")).toBe(true);
    expect(readTaskGoal(options.taskId)?.status).toBe("paused");

    expect(await runCommand(result, "/goal clear")).toBe(true);
    expect(readTaskGoal(options.taskId)).toBeNull();
    expect(options.onClearComposer).toHaveBeenCalledTimes(4);
  });

  it("keeps invalid goal commands and unknown commands out of storage", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/goal edit")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Enter the updated goal objective.",
    );

    expect(
      await runCommand(
        result,
        `/goal ${"x".repeat(GOAL_OBJECTIVE_MAX_LENGTH + 1)}`,
      ),
    ).toBe(true);
    expect(readTaskGoal(options.taskId)).toBeNull();

    expect(await runCommand(result, "/definitely-unknown value")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Unknown command: /definitely-unknown",
      { description: "Type / to browse available commands." },
    );
    expect(options.onClearComposer).not.toHaveBeenCalled();
  });

  it("accepts a 4000-character objective after the /goal edit keyword", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });
    const objective = "x".repeat(GOAL_OBJECTIVE_MAX_LENGTH);

    await runCommand(result, "/goal Initial objective");
    expect(await runCommand(result, `/goal edit ${objective}`)).toBe(true);
    expect(readTaskGoal(options.taskId)?.objective).toBe(objective);
  });

  it("changes the app model and rejects incompatible model names", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(screen.getByTestId("runtime-state")).toHaveTextContent("auto:ask");
    expect(await runCommand(result, "/model codex")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-codex:ask",
      ),
    );
    expect(options.onClearComposer).toHaveBeenCalledTimes(1);

    expect(await runCommand(result, "/model astra")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-astra:ask",
      ),
    );
    expect(options.onClearComposer).toHaveBeenCalledTimes(2);

    expect(await runCommand(result, "/model imaginary-model")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Unknown or incompatible model",
      expect.any(Object),
    );
    expect(options.onClearComposer).toHaveBeenCalledTimes(2);
  });

  it("opens the visible LLM selector when /model has no argument", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/model")).toBe(true);
    expect(openModelSelector).toHaveBeenCalledTimes(1);
    expect(options.onClearComposer).toHaveBeenCalledTimes(1);
    expect(mockToast.info).not.toHaveBeenCalledWith(
      "Model selector is unavailable here",
      expect.anything(),
    );

    jest.mocked(openModelSelector).mockReturnValue(false);
    expect(await runCommand(result, "/model")).toBe(true);
    expect(mockToast.info).toHaveBeenCalledWith(
      "Model selector is unavailable here",
      {
        description:
          "Open a Build or Studio task to choose an available model.",
      },
    );
  });

  it("keeps Studio models purpose-safe and makes /fast media-aware", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Set image purpose" }));

    expect(await runCommand(result, "/model build-codex")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Unknown or incompatible model",
      expect.any(Object),
    );
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "image-gemini:ask",
    );

    expect(await runCommand(result, "/model image-gpt")).toBe(true);
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "image-gpt:ask",
    );
    expect(await runCommand(result, "/fast")).toBe(true);
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "image-lite:ask",
    );

    expect(await runCommand(result, "/model video-kling")).toBe(true);
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "video-kling:agent",
    );
    expect(await runCommand(result, "/fast")).toBe(true);
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "video-veo-fast:agent",
    );
  });

  it("blocks developer-agent prompt commands from entering Studio generation", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Set image purpose" }));

    for (const input of [
      "/init",
      "/review accessibility",
      "/diff",
      "/ps",
      "/plan ship the dashboard",
      "/agent inspect the repository",
    ]) {
      expect(await runCommand(result, input)).toBe(true);
    }

    expect(options.onSubmitPrompt).not.toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledTimes(6);
    expect(mockToast.info).toHaveBeenLastCalledWith(
      "/agent is not available in Studio",
      {
        description: expect.stringContaining("Studio only runs media-safe"),
      },
    );
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "image-gemini:ask",
    );
  });

  it("changes model-aware reasoning effort without changing the model", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "auto:ask:medium",
    );
    expect(await runCommand(result, "/reasoning extra-high")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "auto:ask:xhigh",
      ),
    );

    expect(await runCommand(result, "/model grok")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-grok:ask:high",
      ),
    );

    mockToast.error.mockClear();
    expect(await runCommand(result, "/reasoning xhigh")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Unsupported reasoning level for Grok 4.6",
      { description: "Choose Low, Medium, High." },
    );
    expect(screen.getByTestId("runtime-state")).toHaveTextContent(
      "build-grok:ask:high",
    );

    expect(await runCommand(result, "/reasoning low")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-grok:ask:low",
      ),
    );

    expect(await runCommand(result, "/model sol")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-codex:ask:xhigh",
      ),
    );

    expect(await runCommand(result, "/model kimi")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-kimi:ask:max",
      ),
    );

    expect(await runCommand(result, "/model qwen")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-qwen:ask:on",
      ),
    );

    expect(await runCommand(result, "/reasoning off")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "build-qwen:ask:off",
      ),
    );
  });

  it("opens the mounted reasoning control for bare /reasoning", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/reasoning")).toBe(true);
    expect(openReasoningSelector).toHaveBeenCalledTimes(1);
    expect(options.onClearComposer).toHaveBeenCalledTimes(1);
  });

  it("keeps Build /plan in non-executing Plan mode", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/agent")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent(
        "auto:agent",
      ),
    );

    expect(await runCommand(result, "/plan Ship the dashboard")).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("runtime-state")).toHaveTextContent("auto:ask"),
    );
    expect(options.onSubmitPrompt).toHaveBeenCalledWith(
      expect.stringContaining("without making changes or taking actions"),
      "ask",
    );
    expect(options.onSubmitPrompt).not.toHaveBeenCalledWith(
      expect.stringContaining("then execute"),
      expect.anything(),
    );

    jest.mocked(options.onSubmitPrompt).mockClear();
    expect(await runCommand(result, "/plan")).toBe(true);
    expect(options.onSetComposer).toHaveBeenLastCalledWith("/plan ");
    expect(options.onSubmitPrompt).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-state")).toHaveTextContent("auto:ask");
  });

  it("maps every public Build family alias to a visible catalog choice", () => {
    expect(resolveSlashModel("sol", "app")).toBe("build-codex");
    expect(resolveSlashModel("codex", "app")).toBe("build-codex");
    expect(resolveSlashModel("claude", "app")).toBe("build-fable");
    expect(resolveSlashModel("sonnet", "app")).toBeNull();
    expect(resolveSlashModel("opus", "app")).toBe("build-max");
    expect(resolveSlashModel("grok", "app")).toBe("build-grok");
    expect(resolveSlashModel("kimi", "app")).toBe("build-kimi");
    expect(resolveSlashModel("qwen", "app")).toBe("build-qwen");
    expect(resolveSlashModel("max", "app")).toBeNull();
    expect(resolveSlashModel("auto", "app")).toBe("build-codex");
  });

  it("does not expose retired hidden Build ids through slash commands", () => {
    expect(resolveSlashModel("build-opus46", "app")).toBeNull();
    expect(resolveSlashModel("build-deepseek", "app")).toBeNull();
  });

  it("applies explicit and toggle theme commands", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/theme system")).toBe(true);
    expect(mockSetTheme).toHaveBeenCalledWith("system");

    expect(await runCommand(result, "/theme")).toBe(true);
    expect(mockSetTheme).toHaveBeenCalledWith("light");

    expect(await runCommand(result, "/theme ultraviolet")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      "Choose light, dark, or system",
    );
  });

  it("dispatches the fork event", async () => {
    const options = createRuntimeOptions();
    const listener = jest.fn();
    const unsubscribe = onChatCommand(listener);
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    try {
      expect(await runCommand(result, "/fork")).toBe(true);
      expect(listener).toHaveBeenCalledWith("fork");
      expect(options.onClearComposer).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("routes app, plugin, MCP, and skill commands to their exact workbenches", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    await runCommand(result, "/apps");
    await runCommand(result, "/plugins");
    await runCommand(result, "/mcp");
    await runCommand(result, "/skills");

    expect(mockPush.mock.calls.map(([path]) => path)).toEqual([
      "/plugins",
      "/plugins",
      "/plugins",
      "/plugins?tab=skills",
    ]);
  });

  it("preserves project context for /new, clears it for /task, and opens the project picker", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Set active project" }));

    await runCommand(result, "/new");
    expect(screen.getByTestId("runtime-state")).toHaveTextContent("project-a");

    await runCommand(result, "/project");
    expect(requestProjectSelector).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith("/workspace");

    await runCommand(result, "/task");
    expect(screen.getByTestId("runtime-state")).toHaveTextContent("no-project");
  });

  it("passes /resume search text into the task palette", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    await runCommand(result, "/resume quarterly dashboard");
    expect(openCommandPalette).toHaveBeenCalledWith({
      query: "quarterly dashboard",
    });
  });

  it("translates /mention into the real @files composer convention", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/mention")).toBe(true);
    expect(options.onSetComposer).toHaveBeenLastCalledWith("@files ");

    expect(await runCommand(result, "/mention app/page.tsx")).toBe(true);
    expect(options.onSetComposer).toHaveBeenLastCalledWith(
      "@files app/page.tsx ",
    );
  });

  it("truthfully rejects pasted IDE context commands without a web provider", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/ide-context")).toBe(true);
    expect(mockToast.info).toHaveBeenCalledWith(
      "/ide-context is not available on this surface",
      {
        description:
          "No live IDE context provider is connected to RIFT web. Use @files to reference project files instead.",
      },
    );
    expect(options.onSetComposer).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting and clears the task goal on confirm", async () => {
    const options = createRuntimeOptions();
    browserTaskGoalStore.set(options.taskId, "Goal to delete");
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    expect(await runCommand(result, "/delete")).toBe(true);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(readTaskGoal(options.taskId)).not.toBeNull();
    expect(mockToast.error).toHaveBeenCalledWith(
      "Type /delete confirm to delete this task",
      expect.any(Object),
    );

    expect(await runCommand(result, "/delete confirm")).toBe(true);
    expect(mockMutation).toHaveBeenCalledWith({ chatId: options.taskId });
    expect(readTaskGoal(options.taskId)).toBeNull();
    expect(options.onClearComposer).toHaveBeenCalledTimes(1);
    expect(mockGoHome).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith("Task deleted");
  });

  it("reports rename and delete mutation failures without clearing local state", async () => {
    const options = createRuntimeOptions();
    const { result } = renderHook(() => useSlashCommandRuntime(options), {
      wrapper: RuntimeProvider,
    });

    mockMutation.mockRejectedValueOnce(new Error("rename failed"));
    await runCommand(result, "/rename New title");
    expect(mockToast.error).toHaveBeenCalledWith("Could not rename this task", {
      description: "Try again after the task finishes loading.",
    });
    expect(options.onClearComposer).not.toHaveBeenCalled();

    mockMutation.mockRejectedValueOnce(new Error("delete failed"));
    await runCommand(result, "/delete confirm");
    expect(mockToast.error).toHaveBeenCalledWith("Could not delete this task", {
      description: "Nothing was removed. Try again in a moment.",
    });
    expect(mockGoHome).not.toHaveBeenCalled();
  });
});
