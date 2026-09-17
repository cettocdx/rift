import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mockCloseBottomPanel = jest.fn();
const mockOpenBottomPanel = jest.fn();
const mockToggleTerminalFullscreen = jest.fn();
let mockTerminalFullscreen = false;
let mockTerminalMountCount = 0;
let mockTerminalUnmountCount = 0;
let mockTerminalQuery = "";
let mockTerminalBackend: "local" | "remote" | undefined;
let mockIsTauri = false;
let mockConsoleProvider = false;
jest.mock("@/app/components/terminal/RiftAgentConsoleContext", () => ({
  useHasRiftAgentConsoleProvider: () => mockConsoleProvider,
}));
jest.mock("@/app/components/terminal/RiftAgentConsole", () => ({
  RiftAgentConsole: () => (
    <div data-testid="rift-console-view">RIFT console</div>
  ),
}));
let mockDesktopGrants: Array<{
  grantId: string;
  name: string;
  rootPath: string;
  writable: boolean;
  grantedAt: number;
}> = [];
const mockRequestDesktopAccess = jest.fn();
const mockListDesktopTerminalProfiles = jest.fn();
const mockKillDesktopProfileTerminal = jest.fn();

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockIsTauri,
}));

jest.mock("@/app/hooks/useDesktopWorkspaceAccess", () => ({
  useDesktopWorkspaceAccess: () => ({
    busyAction: null,
    desktopState: mockIsTauri ? "ready" : "unavailable",
    error: null,
    grants: mockDesktopGrants,
    refresh: jest.fn(),
    requestAccess: mockRequestDesktopAccess,
    revokeAccess: jest.fn(),
  }),
}));

jest.mock("@/app/services/desktop-profile-terminal", () => ({
  listDesktopTerminalProfiles: (...args: unknown[]) =>
    mockListDesktopTerminalProfiles(...args),
  closeDesktopProfileTerminalTab: (...args: unknown[]) =>
    mockKillDesktopProfileTerminal(...args),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockTerminalQuery),
}));

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => {
    function MockInteractiveTerminal(props: {
      clientTerminalId: string;
      label: string;
      profile: string;
      focusRequest?: number;
      desktopWorkspaceGrant?: { grantId: string } | null;
      onSessionChange?: (clientTerminalId: string, session: unknown) => void;
      onConnectionChange?: (
        clientTerminalId: string,
        connection: string,
      ) => void;
    }) {
      const ReactModule = require("react") as typeof React;
      ReactModule.useEffect(() => {
        mockTerminalMountCount += 1;
        props.onSessionChange?.(props.clientTerminalId, {
          id: "0123456789abcdef01234567",
          clientTerminalId: props.clientTerminalId,
          pid: 42,
          cwd: "/home/user",
          cols: 80,
          rows: 24,
          status: "running",
          exitCode: null,
          createdAt: 1,
          lastActivityAt: 1,
          expiresAt: 2,
          backend: mockTerminalBackend,
        });
        props.onConnectionChange?.(props.clientTerminalId, "connected");
        return () => {
          mockTerminalUnmountCount += 1;
        };
      }, [
        props.clientTerminalId,
        props.onConnectionChange,
        props.onSessionChange,
      ]);
      return (
        <div
          data-testid={`pty-${props.clientTerminalId}`}
          data-profile={props.profile}
          data-focus-request={props.focusRequest ?? 0}
          data-desktop-grant={props.desktopWorkspaceGrant?.grantId ?? ""}
        >
          {props.label}
        </div>
      );
    }
    return MockInteractiveTerminal;
  },
}));

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    state: { terminalFullscreen: mockTerminalFullscreen },
    actions: {
      closeBottomPanel: mockCloseBottomPanel,
      openBottomPanel: mockOpenBottomPanel,
      toggleTerminalFullscreen: mockToggleTerminalFullscreen,
    },
  }),
  useWorkbenchRequestHeaders: () => ({ "X-RIFT-Workbench": "1" }),
}));

jest.mock("../WorkbenchActivity", () => ({
  useWorkbenchActivity: () => ({ terminal: null }),
}));

jest.mock("../WorkbenchCli", () => ({
  WorkbenchCli: () => <div>Runner</div>,
}));

jest.mock("@/app/components/TerminalCodeBlock", () => ({
  TerminalCodeBlock: () => <div>Agent output</div>,
}));

import { WorkbenchTerminalPanel } from "../WorkbenchTerminalPanel";
import {
  persistWorkbenchTerminalScrollback,
  readWorkbenchTerminalScrollback,
} from "../terminal-scrollback";

describe("WorkbenchTerminalPanel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.sessionStorage.clear();
    mockCloseBottomPanel.mockClear();
    mockOpenBottomPanel.mockClear();
    mockToggleTerminalFullscreen.mockClear();
    mockTerminalFullscreen = false;
    mockTerminalMountCount = 0;
    mockTerminalUnmountCount = 0;
    mockTerminalQuery = "";
    mockTerminalBackend = undefined;
    mockIsTauri = false;
    mockConsoleProvider = false;
    mockDesktopGrants = [];
    mockRequestDesktopAccess.mockReset();
    mockListDesktopTerminalProfiles.mockReset();
    mockKillDesktopProfileTerminal.mockReset();
    mockKillDesktopProfileTerminal.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("opens the console without allocating a shell, then retains the PTY across view switches", async () => {
    mockConsoleProvider = true;
    render(<WorkbenchTerminalPanel compact />);
    expect(screen.getByRole("tab", { name: "RIFT console" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mockTerminalMountCount).toBe(0);
    fireEvent.click(screen.getByRole("tab", { name: "Terminal", exact: true }));
    const terminal = await screen.findByTestId(/^pty-/);
    expect(mockTerminalMountCount).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: "RIFT console" }));
    fireEvent.click(screen.getByRole("tab", { name: "Terminal", exact: true }));
    expect(screen.getByTestId(/^pty-/)).toBe(terminal);
    expect(mockTerminalUnmountCount).toBe(0);
  });

  it("closes the active compact shell while keeping close controls out of the console", async () => {
    mockIsTauri = true;
    mockTerminalBackend = "local";
    mockConsoleProvider = true;
    mockListDesktopTerminalProfiles.mockResolvedValue({
      backend: "local",
      profiles: ["shell", "claude", "codex", "grok"].map((profile) => ({
        profile,
        available: true,
        runtimeLabel: profile,
        unavailableReason: null,
      })),
    });
    render(<WorkbenchTerminalPanel compact />);
    expect(
      screen.queryByRole("button", { name: "Close active terminal" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Terminal", exact: true }));
    const firstTerminal = await screen.findByTestId(/^pty-/);
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(screen.getAllByTestId(/^pty-/)).toHaveLength(2));
    const activeTerminal = screen
      .getAllByTestId(/^pty-/)
      .find((terminal) => terminal !== firstTerminal)!;
    const activeId = activeTerminal.dataset.testid!.slice("pty-".length);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Terminal actions" }),
      { key: "Enter" },
    );
    const close = await screen.findByRole("menuitem", {
      name: "Close active terminal",
    });
    fireEvent.click(close);

    await waitFor(() =>
      expect(mockKillDesktopProfileTerminal).toHaveBeenCalledWith(activeId),
    );
    expect(activeTerminal).not.toBeInTheDocument();
    expect(firstTerminal).toBeInTheDocument();
    expect(mockCloseBottomPanel).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "RIFT console" }));
    expect(screen.getByTestId("rift-console-view")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close active terminal" }),
    ).not.toBeInTheDocument();
  });

  it("opens the restored terminal view directly and reports later view changes to its host", async () => {
    mockConsoleProvider = true;
    const onViewChange = jest.fn();
    const view = render(
      <WorkbenchTerminalPanel
        compact
        view="terminal"
        onViewChange={onViewChange}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Terminal", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const terminal = await screen.findByTestId(/^pty-/);
    fireEvent.click(screen.getByRole("tab", { name: "RIFT console" }));
    expect(onViewChange).toHaveBeenCalledWith("agent");
    view.rerender(
      <WorkbenchTerminalPanel
        compact
        view="agent"
        onViewChange={onViewChange}
      />,
    );
    expect(screen.getByRole("tab", { name: "RIFT console" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    view.rerender(
      <WorkbenchTerminalPanel
        compact
        view="terminal"
        onViewChange={onViewChange}
      />,
    );
    expect(screen.getByTestId(/^pty-/)).toBe(terminal);
    expect(mockTerminalUnmountCount).toBe(0);
  });

  it("adds terminal tabs and switches between right and down splits", async () => {
    render(<WorkbenchTerminalPanel />);
    expect(
      await screen.findByRole("tab", { name: "Terminal 1" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(
      await screen.findByRole("tab", { name: "Terminal 2" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(
      screen.getByRole("button", { name: "Split terminal right" }),
    );
    expect(
      await screen.findByRole("tab", { name: /Terminal 3 split/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^pty-/)).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "Split terminal down" }),
    );
    expect(screen.getAllByTestId(/^pty-/)).toHaveLength(3);
    expect(
      screen.getByRole("tab", { name: /Terminal 3 split/ }),
    ).toBeInTheDocument();
  });

  it("disables unavailable remote agent CLIs instead of launching a shell under their name", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        backend: "remote",
        profiles: [
          {
            profile: "shell",
            available: true,
            runtimeLabel: "Isolated sandbox bash",
            unavailableReason: null,
          },
          ...["claude", "codex", "grok"].map((profile) => ({
            profile,
            available: false,
            runtimeLabel: "",
            unavailableReason: "Local workspace required.",
          })),
        ],
      }),
    });

    const { container } = render(<WorkbenchTerminalPanel />);
    const profileSelect = await screen.findByRole("combobox", {
      name: "New terminal profile",
    });

    expect(
      await within(profileSelect).findByRole("option", {
        name: "Codex - unavailable",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Sandbox shell only")).toHaveClass("sr-only");
    expect(
      container.querySelector(
        "[data-terminal-session-tab] [class*='rounded-full']",
      ),
    ).toBeNull();

    const refresh = screen.getByRole("button", {
      name: "Refresh CLI profile detection",
    });
    const previousRequests = (global.fetch as jest.Mock).mock.calls.length;
    fireEvent.click(refresh);
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(
        previousRequests,
      ),
    );
  });

  it("launches a verified local CLI immediately and switches back to its live PTY", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        backend: "local",
        profiles: [
          ["shell", "macOS zsh"],
          ["claude", "Claude Code"],
          ["codex", "Codex"],
          ["grok", "Grok"],
        ].map(([profile, runtimeLabel]) => ({
          profile,
          available: true,
          runtimeLabel,
          unavailableReason: null,
        })),
      }),
    });

    render(<WorkbenchTerminalPanel />);
    const profileSelect = await screen.findByRole("combobox", {
      name: "New terminal profile",
    });
    await screen.findByText("Local CLI launchers checked");
    fireEvent.change(profileSelect, { target: { value: "codex" } });
    const newTerminal = screen.getByRole("button", { name: "New terminal" });
    await waitFor(() => {
      expect(profileSelect).toHaveValue("codex");
      expect(newTerminal).toBeEnabled();
    });

    const secondTab = await screen.findByRole("tab", { name: "Terminal 2" });
    const codexTerminal = screen.getByTestId(
      `pty-${secondTab.dataset.terminalTab}`,
    );
    expect(codexTerminal).toHaveAttribute("data-profile", "codex");
    expect(Number(codexTerminal.dataset.focusRequest)).toBeGreaterThan(0);
    expect(mockOpenBottomPanel).toHaveBeenCalled();

    fireEvent.change(profileSelect, { target: { value: "claude" } });
    await screen.findByRole("tab", { name: "Terminal 3" });
    fireEvent.change(profileSelect, { target: { value: "codex" } });

    await waitFor(() =>
      expect(secondTab).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getAllByTestId(/^pty-/)).toHaveLength(3);
  });

  it("uses native profile detection and an explicit writable grant in Tauri", async () => {
    mockIsTauri = true;
    mockDesktopGrants = [
      {
        grantId: "grant-opaque",
        name: "rift-project",
        rootPath: "/Users/test/rift-project",
        writable: true,
        grantedAt: 42,
      },
    ];
    mockListDesktopTerminalProfiles.mockResolvedValue({
      backend: "local",
      profiles: [
        ["shell", "System shell"],
        ["claude", "Claude Code"],
        ["codex", "Codex"],
        ["grok", "Grok"],
      ].map(([profile, runtimeLabel]) => ({
        profile,
        available: true,
        runtimeLabel,
        unavailableReason: null,
      })),
    });

    render(<WorkbenchTerminalPanel />);
    const profileSelect = await screen.findByRole("combobox", {
      name: "New terminal profile",
    });
    await screen.findByText("Local CLI launchers checked");
    expect(mockListDesktopTerminalProfiles).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.change(profileSelect, { target: { value: "codex" } });
    const codexTab = await screen.findByRole("tab", { name: "Terminal 2" });
    expect(
      screen.getByTestId(`pty-${codexTab.dataset.terminalTab}`),
    ).toHaveAttribute("data-desktop-grant", "grant-opaque");
    expect(
      screen.getByRole("button", {
        name: "Choose another terminal workspace folder",
      }),
    ).toBeEnabled();
  });

  it("allows a standalone shell while retaining folder consent for native CLIs", async () => {
    mockIsTauri = true;
    mockListDesktopTerminalProfiles.mockResolvedValue({
      backend: "local",
      profiles: ["shell", "claude", "codex", "grok"].map((profile) => ({
        profile,
        available: true,
        runtimeLabel: profile,
        unavailableReason: null,
      })),
    });

    render(<WorkbenchTerminalPanel />);
    await screen.findByText("Local CLI launchers checked");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New terminal" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Choose workspace folder" }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: "New terminal profile" }),
      { target: { value: "codex" } },
    );
    const chooseFolder = await screen.findByRole("button", {
      name: "Choose workspace folder",
    });
    expect(screen.getByRole("button", { name: "New terminal" })).toBeDisabled();

    fireEvent.click(chooseFolder);
    expect(mockRequestDesktopAccess).toHaveBeenCalledWith(true);
  });

  it("opens and focuses the terminal requested by the global Command-J intent", async () => {
    mockTerminalQuery = "terminal=focus";

    render(<WorkbenchTerminalPanel />);
    const firstTab = await screen.findByRole("tab", { name: "Terminal 1" });
    const terminal = screen.getByTestId(`pty-${firstTab.dataset.terminalTab}`);

    await waitFor(() => expect(mockOpenBottomPanel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(Number(terminal.dataset.focusRequest)).toBeGreaterThan(0),
    );
  });

  it("supports roving tab focus, Delete to close, and accessible controls", async () => {
    render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    const tabList = screen.getByRole("tablist", { name: "Terminal sessions" });
    const second = await within(tabList).findByRole("tab", {
      name: "Terminal 2",
    });

    fireEvent.keyDown(second, { key: "ArrowLeft" });
    const first = within(tabList).getByRole("tab", { name: "Terminal 1" });
    expect(first).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(first, { key: "Delete" });
    await waitFor(() =>
      expect(
        within(tabList).queryByRole("tab", { name: "Terminal 1" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Close active terminal" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("toolbar", { name: "Terminal layout controls" }),
    ).toBeInTheDocument();
  });

  it("restores the tab layout from session storage and closes the remote PTY", async () => {
    const firstRender = render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await screen.findByRole("tab", { name: "Terminal 2" });
    firstRender.unmount();

    render(<WorkbenchTerminalPanel />);
    const restoredActive = await screen.findByRole("tab", {
      name: "Terminal 2",
    });
    await waitFor(() =>
      expect(restoredActive).toHaveAttribute(
        "data-terminal-connection",
        "connected",
      ),
    );
    expect(
      screen.getByRole("tablist", { name: "Terminal sessions" }),
    ).toBeInTheDocument();
    const activeTerminalId = restoredActive.dataset.terminalTab!;
    persistWorkbenchTerminalScrollback(activeTerminalId, {
      bytes: new TextEncoder().encode("sensitive output"),
      sessionId: "0123456789abcdef01234567",
      cursor: 16,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close active terminal" }),
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workbench/terminal/sessions/0123456789abcdef01234567",
        expect.objectContaining({ method: "DELETE", keepalive: true }),
      ),
    );
    await waitFor(() =>
      expect(readWorkbenchTerminalScrollback(activeTerminalId)).toHaveLength(0),
    );
  });

  it("keeps the last terminal closed through remount until explicitly started", async () => {
    const first = render(<WorkbenchTerminalPanel />);
    const tab = await screen.findByRole("tab", { name: "Terminal 1" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "Delete" });
    await screen.findByText("No terminal is running.");
    expect(screen.queryByTestId(/^pty-/)).not.toBeInTheDocument();
    expect(mockTerminalMountCount).toBe(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start terminal" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: "Close active terminal" }),
    ).toBeDisabled();
    first.unmount();
    render(<WorkbenchTerminalPanel />);
    await screen.findByText("No terminal is running.");
    expect(mockTerminalMountCount).toBe(1);
    expect(
      screen.getByRole("button", { name: "Start terminal" }),
    ).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    await screen.findByRole("tab", { name: "Terminal 2" });
    expect(mockTerminalMountCount).toBe(2);
  });

  it("focuses Start terminal for an explicit terminal intent on a saved empty layout", async () => {
    const first = render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });
    fireEvent.click(
      screen.getByRole("button", { name: "Close active terminal" }),
    );
    await screen.findByText("No terminal is running.");
    first.unmount();
    mockTerminalQuery = "terminal=focus";
    mockConsoleProvider = true;
    render(<WorkbenchTerminalPanel compact />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start terminal" }),
      ).toHaveFocus(),
    );
    expect(mockTerminalMountCount).toBe(1);
    expect(
      screen.getByRole("button", { name: "Start terminal" }),
    ).toBeVisible();
  });

  it("does not mistake the localhost HTTP backend for a Tauri PTY", async () => {
    mockTerminalBackend = "local";
    render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });

    fireEvent.click(
      screen.getByRole("button", { name: "Close active terminal" }),
    );

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workbench/terminal/sessions/0123456789abcdef01234567",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(mockKillDesktopProfileTerminal).not.toHaveBeenCalled();
  });

  it("closes a Tauri PTY through the bounded native command", async () => {
    mockIsTauri = true;
    mockTerminalBackend = "local";
    mockDesktopGrants = [
      {
        grantId: "grant-opaque",
        name: "rift-project",
        rootPath: "/Users/test/rift-project",
        writable: true,
        grantedAt: 42,
      },
    ];
    mockListDesktopTerminalProfiles.mockResolvedValue({
      backend: "local",
      profiles: ["shell", "claude", "codex", "grok"].map((profile) => ({
        profile,
        available: true,
        runtimeLabel: profile,
        unavailableReason: null,
      })),
    });

    render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });
    fireEvent.click(
      screen.getByRole("button", { name: "Close active terminal" }),
    );

    await waitFor(() =>
      expect(mockKillDesktopProfileTerminal).toHaveBeenCalledWith(
        expect.stringMatching(/^terminal-/),
      ),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("opens Shell from the compact menu after closing the last session", async () => {
    render(<WorkbenchTerminalPanel compact />);
    await screen.findByTestId(/^pty-/);
    const openMenu = () =>
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Terminal actions" }),
        { key: "Enter" },
      );
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Close active terminal" }),
    );
    await screen.findByText("No terminal is running.");
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Shell", exact: true }),
    );
    expect(await screen.findByTestId(/^pty-/)).toHaveAttribute(
      "data-profile",
      "shell",
    );
    openMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Shell", exact: true }),
    );
    expect(screen.getAllByTestId(/^pty-/)).toHaveLength(1);
    expect(mockTerminalMountCount).toBe(2);
  });

  it("navigates compact sessions by keyboard without remounting shells", async () => {
    render(<WorkbenchTerminalPanel compact />);
    await screen.findByTestId(/^pty-/);
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    const tabs = within(
      screen.getByRole("tablist", { name: "Terminal sessions" }),
    ).getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: "ArrowLeft" });
    await waitFor(() => expect(tabs[0]).toHaveFocus());
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(
      document.getElementById(tabs[0].getAttribute("aria-controls")!),
    ).toBeInTheDocument();
    expect(mockTerminalMountCount).toBe(2);
    expect(mockTerminalUnmountCount).toBe(0);
  });

  it("announces host fullscreen while retaining the console view", () => {
    mockConsoleProvider = true;
    const onToggleFullscreen = jest.fn();
    render(
      <WorkbenchTerminalPanel
        compact
        hostFullscreen
        onToggleFullscreen={onToggleFullscreen}
      />,
    );
    const restore = screen.getByRole("button", {
      name: "Exit full-screen terminal",
    });
    expect(restore).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: "RIFT console" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(restore);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(mockToggleTerminalFullscreen).not.toHaveBeenCalled();
  });

  it("offers an accessible full-screen toggle without remounting terminal sessions", async () => {
    const rendered = render(<WorkbenchTerminalPanel />);
    await screen.findByRole("tab", { name: "Terminal 1" });
    const terminal = screen.getByTestId(/^pty-/);
    expect(mockTerminalMountCount).toBe(1);

    const openFullscreen = screen.getByRole("button", {
      name: "Open full-screen terminal",
    });
    expect(openFullscreen).toHaveAttribute("aria-pressed", "false");
    expect(openFullscreen).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Shift+J Control+Shift+J",
    );
    fireEvent.click(openFullscreen);
    expect(mockToggleTerminalFullscreen).toHaveBeenCalledTimes(1);

    mockTerminalFullscreen = true;
    rendered.rerender(<WorkbenchTerminalPanel />);
    expect(
      screen.getByRole("button", { name: "Exit full-screen terminal" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("tab", { name: "Command runner" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(/^pty-/)).toBe(terminal);
    expect(mockTerminalMountCount).toBe(1);
    expect(mockTerminalUnmountCount).toBe(0);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Terminal" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
