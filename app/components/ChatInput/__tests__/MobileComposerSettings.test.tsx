import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";

import { MobileComposerSettings } from "../MobileComposerSettings";
import { observeChatViewport } from "@/app/components/chat-layout/ChatViewport";
import {
  consumeProjectSelectorRequest,
  requestProjectSelector,
} from "@/lib/utils/composer-controls";

const mockSetActiveProject = jest.fn();
const mockStopObservingViewport = jest.fn();
const mockProjects = [
  { _id: "project-1", name: "Launch app", type: "app" },
  { _id: "project-2", name: "Bot workspace", type: "app" },
];
let mockChat: Record<string, string> | null = null;

jest.mock("convex/react", () => ({
  useQuery: (query: never) =>
    getFunctionName(query) === "chats:getChatByIdFromClient"
      ? mockChat
      : mockProjects,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    activeProject: null,
    setActiveProject: mockSetActiveProject,
    sandboxPreference: "e2b",
    setSandboxPreference: jest.fn(),
    hasLocalSandbox: false,
    isSelectedSandboxAvailable: true,
    localExecutionTargets: [],
    defaultLocalSandboxPreference: null,
    chatMode: "agent",
    setChatMode: jest.fn(),
    chatPurpose: "app",
    temporaryChatsEnabled: false,
  }),
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      name: "Ada Lovelace",
      profilePictureUrl: null,
    },
  }),
}));

jest.mock("@/app/hooks/useTauri", () => ({
  navigateToAuth: jest.fn(),
}));

jest.mock("@/app/components/chat-layout/ChatViewport", () => ({
  observeChatViewport: jest.fn(),
}));

function requestProject() {
  act(() => {
    expect(requestProjectSelector()).toBe(true);
  });
}

describe("mobile composer settings", () => {
  beforeEach(() => {
    mockChat = null;
    window.sessionStorage.clear();
    window.localStorage.clear();
    jest.clearAllMocks();
    jest.mocked(observeChatViewport).mockReturnValue(mockStopObservingViewport);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("opens the sheet and real project picker for /project, then applies the selection", async () => {
    const user = userEvent.setup();
    render(<MobileComposerSettings chatId="chat-a" showWorkspace />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    requestProject();

    const project = await screen.findByRole("menuitemradio", {
      name: /^Launch app/,
    });
    expect(project).toBeVisible();
    expect(consumeProjectSelectorRequest()).toBe(false);
    await user.click(project);
    expect(mockSetActiveProject).toHaveBeenCalledWith({
      id: "project-1",
      name: "Launch app",
      type: "app",
    });
    expect(screen.getByRole("dialog", { name: "Chat settings" })).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Close chat settings" }),
    );
    const trigger = screen.getByRole("button", { name: "Chat settings" });
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(
      screen.getByRole("button", { name: "Select project context" }),
    ).toBeVisible();
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });

  it("opens the requested picker even when session storage is unavailable", async () => {
    jest.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    render(<MobileComposerSettings chatId="chat-a" showWorkspace />);

    requestProject();

    expect(
      await screen.findByRole("menuitemradio", { name: /^Launch app/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitemradio", { name: /^No project/ }),
    ).toBeVisible();
  });

  it.each(["project_bot_id", "bot_meeting_id"])(
    "explains a project locked by %s without exposing a selectable picker",
    async (binding) => {
      mockChat = {
        id: "bot-chat",
        project_id: "project-2",
        [binding]: "bot-binding",
      };
      render(<MobileComposerSettings chatId="bot-chat" showWorkspace />);

      requestProject();

      expect(
        await screen.findByText(
          "This bot uses its project workspace. Start a new chat to choose another project.",
        ),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Project: Bot workspace" }),
      ).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Select project context" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
      expect(mockSetActiveProject).toHaveBeenCalledWith({
        id: "project-2",
        name: "Bot workspace",
        type: "app",
      });
    },
  );

  it("observes the first attached portal and cleans up on close and unmount", async () => {
    const user = userEvent.setup();
    const { rerender, unmount } = render(
      <MobileComposerSettings chatId="chat-a" showWorkspace />,
    );
    const trigger = screen.getByRole("button", { name: "Chat settings" });
    expect(observeChatViewport).not.toHaveBeenCalled();

    await user.click(trigger);

    const panel = screen.getByRole("dialog", { name: "Chat settings" });
    const attachedObservers = () =>
      jest.mocked(observeChatViewport).mock.calls.length;
    expect(attachedObservers()).toBeGreaterThan(0);
    expect(observeChatViewport).toHaveBeenCalledWith(panel);
    // Radix can recompose refs while opening. Every superseded attachment
    // must stop observing, leaving exactly one live observer on the panel.
    expect(mockStopObservingViewport).toHaveBeenCalledTimes(
      attachedObservers() - 1,
    );
    rerender(<MobileComposerSettings chatId="chat-a" showWorkspace />);
    expect(observeChatViewport).toHaveBeenLastCalledWith(panel);
    expect(mockStopObservingViewport).toHaveBeenCalledTimes(
      attachedObservers() - 1,
    );

    await user.click(
      screen.getByRole("button", { name: "Close chat settings" }),
    );
    expect(panel).not.toBeInTheDocument();
    const beforeReopen = attachedObservers();
    expect(mockStopObservingViewport).toHaveBeenCalledTimes(beforeReopen);
    await user.click(trigger);
    expect(attachedObservers()).toBeGreaterThan(beforeReopen);
    expect(mockStopObservingViewport).toHaveBeenCalledTimes(
      attachedObservers() - 1,
    );
    unmount();
    expect(mockStopObservingViewport).toHaveBeenCalledTimes(
      attachedObservers(),
    );
  });

  it("leaves unsupported project requests unhandled and removes its listener on unmount", () => {
    const { rerender, unmount } = render(
      <MobileComposerSettings showWorkspace={false} />,
    );
    act(() => {
      expect(requestProjectSelector()).toBe(false);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<MobileComposerSettings showWorkspace />);
    unmount();

    expect(requestProjectSelector()).toBe(false);
  });
});
