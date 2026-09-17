import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockActions = {
  openFile: jest.fn(),
  loadDirectory: jest.fn(),
  selectSidebarView: jest.fn(),
  toggleSidebar: jest.fn(),
  toggleAgentPane: jest.fn(),
  toggleBottomPanel: jest.fn(),
  openBottomPanel: jest.fn(),
  saveActiveDocument: jest.fn(),
  confirmNavigation: jest.fn(() => true),
};

let mockWorkbenchState = {
  sidebarOpen: true,
  sidebarView: "explorer" as const,
  agentPaneOpen: true,
  bottomPanelOpen: true,
  terminalFullscreen: false,
  activePath: null,
  documents: {},
  git: {
    status: null,
    truncated: false,
  },
};

const mockInitializeNewChat = jest.fn();
const mockCloseSidebar = jest.fn();
const mockGoHome = jest.fn();
const mockOpenCommandPalette = jest.fn();
const mockOpenSettingsDialog = jest.fn();

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    state: mockWorkbenchState,
    actions: mockActions,
    meta: {},
  }),
}));

jest.mock("../WorkbenchActivity", () => ({
  useWorkbenchActivity: () => ({
    terminal: null,
    interactiveTerminal: "starting",
  }),
}));

jest.mock("../WorkbenchChanges", () => ({
  WorkbenchChanges: () => (
    <section aria-label="Changes content">Changed files surface</section>
  ),
}));

jest.mock("../WorkbenchExplorer", () => ({
  WorkbenchExplorer: () => (
    <section aria-label="Files content">Workspace files surface</section>
  ),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat: mockInitializeNewChat,
    closeSidebar: mockCloseSidebar,
  }),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goHome: mockGoHome }),
}));

jest.mock("@/app/hooks/useHydrated", () => ({
  useHydrated: () => true,
}));

jest.mock("@/app/components/pro/ProTitlebarModelMenu", () => ({
  ProTitlebarModelMenu: () => null,
}));

jest.mock("@/lib/utils/command-palette", () => ({
  openCommandPalette: () => mockOpenCommandPalette(),
}));

import { Workbench } from "../Workbench";
const { WorkbenchExplorer: RealExplorer } = jest.requireActual(
  "../WorkbenchExplorer",
);

function MobileWorkspace() {
  return (
    <Workbench.Root>
      <Workbench.Body>
        <Workbench.Sidebar>
          <Workbench.SidebarContent />
        </Workbench.Sidebar>
        <Workbench.EditorGroup>
          <Workbench.EditorPane>
            <div>Editor surface</div>
          </Workbench.EditorPane>
          <Workbench.BottomPanel>
            <input aria-label="Terminal session state" defaultValue="" />
          </Workbench.BottomPanel>
        </Workbench.EditorGroup>
        <Workbench.AgentPane>
          <div>Agent conversation surface</div>
        </Workbench.AgentPane>
      </Workbench.Body>
      <Workbench.MobileNavigation />
    </Workbench.Root>
  );
}

describe("Workbench mobile surface navigation at 375px", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });
    mockWorkbenchState = {
      sidebarOpen: true,
      sidebarView: "explorer",
      agentPaneOpen: true,
      bottomPanelOpen: true,
      terminalFullscreen: false,
      activePath: null,
      documents: {},
      git: { status: null, truncated: false },
    };
    jest.clearAllMocks();
  });

  it("reaches Agent, Terminal, Files, and Changes without horizontal overflow", () => {
    const { container } = render(<MobileWorkspace />);
    const shell = container.querySelector("[data-pro-workbench]");
    const navigation = screen.getByRole("navigation", {
      name: "Mobile workspace surfaces",
    });
    const controls = within(navigation).getAllByRole("button");

    expect(shell).toHaveAttribute("data-mobile-workbench-surface", "agent");
    expect(shell).toHaveClass("min-w-0", "overflow-hidden");
    expect(navigation).toHaveClass("w-full", "min-w-0", "grid-cols-5", "gap-2");
    expect(controls).toHaveLength(5);
    controls.forEach((control) => {
      expect(control).toHaveClass("min-h-11", "min-w-0");
    });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(shell).toHaveAttribute("data-mobile-workbench-surface", "terminal");
    expect(
      screen.getByRole("region", { name: "Workbench terminal" }),
    ).toHaveClass("flex");

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(shell).toHaveAttribute("data-mobile-workbench-surface", "files");
    expect(screen.getByLabelText("Files content")).toHaveTextContent(
      "Workspace files surface",
    );
    expect(
      container.querySelector("[data-workbench-mobile-sidebar]"),
    ).toHaveClass("flex");

    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(shell).toHaveAttribute("data-mobile-workbench-surface", "changes");
    expect(screen.getByLabelText("Changes content")).toHaveTextContent(
      "Changed files surface",
    );

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(shell).toHaveAttribute("data-mobile-workbench-surface", "agent");
    expect(screen.getByRole("region", { name: "RIFT agent" })).toHaveClass(
      "flex",
    );
  });

  it("keeps the terminal mounted and preserves its state across surface switches", () => {
    render(<MobileWorkspace />);
    const terminalInput = screen.getByLabelText("Terminal session state");

    fireEvent.change(terminalInput, { target: { value: "pnpm test" } });
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));

    expect(screen.getByLabelText("Terminal session state")).toBe(terminalInput);
    expect(terminalInput).toHaveValue("pnpm test");
    expect(mockActions.openBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("opens and reopens the same file on mobile without remounting the editor", () => {
    Object.assign(mockWorkbenchState, {
      directories: {
        "": { entries: [{ name: "hello.ts", path: "hello.ts", type: "file" }] },
      },
      expandedDirectories: new Set(),
    });
    const { container } = render(
      <Workbench.Root>
        <Workbench.Body>
          <Workbench.Sidebar>
            <RealExplorer />
          </Workbench.Sidebar>
          <Workbench.EditorGroup>
            <Workbench.EditorPane>
              <input aria-label="File content" defaultValue="original" />
            </Workbench.EditorPane>
            <Workbench.BottomPanel>
              <div>Terminal</div>
            </Workbench.BottomPanel>
          </Workbench.EditorGroup>
          <Workbench.AgentPane>
            <div>Agent</div>
          </Workbench.AgentPane>
        </Workbench.Body>
        <Workbench.MobileNavigation />
      </Workbench.Root>,
    );
    const shell = container.querySelector("[data-pro-workbench]");
    const editor = screen.getByLabelText("File content");
    const pane = editor.parentElement!;
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(
        screen.getByRole("button", { name: "Files", exact: true }),
      );
      fireEvent.click(
        screen.getByRole("treeitem", { name: "hello.ts", exact: true }),
      );
      expect(mockActions.openFile).toHaveBeenCalledTimes(attempt + 1);
      expect(mockActions.openFile).toHaveBeenLastCalledWith("hello.ts");
      expect(shell).toHaveAttribute("data-mobile-workbench-surface", "editor");
      expect(pane).toHaveClass("flex", "lg:flex");
      expect(pane).not.toHaveClass("hidden");
      expect(pane.parentElement).toHaveClass("flex", "lg:flex");
      fireEvent.change(editor, { target: { value: "unsaved edit" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Agent", exact: true }),
      );
      expect(pane).toHaveClass("hidden", "lg:flex");
      expect(screen.getByLabelText("File content")).toBe(editor);
      expect(editor).toHaveValue("unsaved edit");
    }
  });

  it("puts secondary commands and desktop split controls in More", async () => {
    const user = userEvent.setup();
    render(<MobileWorkspace />);

    await user.click(
      screen.getByRole("button", { name: "More workspace actions" }),
    );

    const menu = screen.getByRole("menu");
    const searchAction = within(menu).getByRole("menuitem", {
      name: "Search and commands",
    });
    const settingsAction = within(menu).getByRole("menuitem", {
      name: "Settings",
    });
    const splitControls = within(menu).getAllByRole("menuitemcheckbox");

    expect(searchAction).toHaveClass("min-h-11");
    expect(settingsAction).toHaveClass("min-h-11");
    expect(splitControls).toHaveLength(3);
    splitControls.forEach((control) => expect(control).toHaveClass("min-h-11"));

    await user.click(searchAction);
    expect(mockOpenCommandPalette).toHaveBeenCalledTimes(1);
  });
});
