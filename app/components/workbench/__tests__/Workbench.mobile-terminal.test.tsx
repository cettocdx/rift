import React from "react";
import { render, screen } from "@testing-library/react";

let mockWorkbenchState = {
  bottomPanelOpen: true,
  agentPaneOpen: true,
  terminalFullscreen: false,
};

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({ state: mockWorkbenchState, actions: {}, meta: {} }),
}));

jest.mock("../WorkbenchActivity", () => ({
  useWorkbenchActivity: () => ({
    terminal: null,
    interactiveTerminal: "starting",
  }),
}));

jest.mock("../WorkbenchTerminalPanel", () => ({
  WorkbenchTerminalPanel: () => <div>Terminal panel</div>,
}));

jest.mock("../WorkbenchChanges", () => ({
  WorkbenchChanges: () => null,
}));

jest.mock("../WorkbenchExplorer", () => ({
  WorkbenchExplorer: () => null,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({}),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({}),
}));

jest.mock("@/app/hooks/useHydrated", () => ({
  useHydrated: () => true,
}));

jest.mock("@/app/components/pro/ProTitlebarModelMenu", () => ({
  ProTitlebarModelMenu: () => null,
}));

import { Workbench } from "../Workbench";

function ResponsiveSurfaces() {
  return (
    <>
      <Workbench.EditorGroup>
        <Workbench.EditorPane>
          <div>Editor</div>
        </Workbench.EditorPane>
        <Workbench.BottomPanel>
          <div>PTY surface</div>
        </Workbench.BottomPanel>
      </Workbench.EditorGroup>
      <Workbench.AgentPane>
        <div>Agent chat</div>
      </Workbench.AgentPane>
    </>
  );
}

describe("Workbench mobile terminal visibility", () => {
  it("keeps the graphite workspace adaptive instead of forcing dark mode", () => {
    const { container } = render(
      <Workbench.Root>
        <div>Workspace</div>
      </Workbench.Root>,
    );
    const themeScope = container.querySelector(
      '[data-workbench-color-scheme="adaptive"]',
    );
    expect(themeScope).not.toHaveClass("dark");
    expect(container.querySelector("[data-pro-workbench]")).toHaveClass(
      "bg-workbench-canvas",
      "text-workbench-text",
    );
  });

  it("shows a real terminal surface when the mobile terminal toggle is on", () => {
    mockWorkbenchState = {
      bottomPanelOpen: true,
      agentPaneOpen: true,
      terminalFullscreen: false,
    };
    const { container, rerender } = render(<ResponsiveSurfaces />);

    const editor = screen.getByRole("main");
    const terminal = screen.getByRole("region", {
      name: "Workbench terminal",
    });
    const agent = screen.getByRole("region", {
      name: "RIFT agent",
      hidden: true,
    });
    expect(editor).toHaveClass("flex", "lg:flex");
    expect(editor).not.toHaveClass("hidden");
    expect(terminal).toHaveClass("flex", "flex-1", "lg:flex-none");
    expect(terminal).toHaveAttribute("aria-hidden", "false");
    expect(agent).toHaveClass("hidden", "lg:flex");

    mockWorkbenchState = {
      bottomPanelOpen: false,
      agentPaneOpen: true,
      terminalFullscreen: false,
    };
    rerender(<ResponsiveSurfaces />);
    expect(screen.getByRole("main", { hidden: true })).toHaveClass("hidden");
    expect(
      container.querySelector('[aria-label="Workbench terminal"]'),
    ).toHaveClass("hidden");
    expect(screen.getByRole("region", { name: "RIFT agent" })).toHaveClass(
      "flex",
      "lg:flex",
    );
  });

  it("fills the workspace with the terminal and restores panes without unmounting it", () => {
    mockWorkbenchState = {
      bottomPanelOpen: true,
      agentPaneOpen: true,
      terminalFullscreen: false,
    };
    const { rerender } = render(<ResponsiveSurfaces />);
    const terminalSurface = screen.getByText("PTY surface");

    mockWorkbenchState = {
      bottomPanelOpen: true,
      agentPaneOpen: true,
      terminalFullscreen: true,
    };
    rerender(<ResponsiveSurfaces />);

    expect(screen.getByRole("main")).toHaveClass("flex", "min-w-0");
    expect(screen.getByText("Editor").parentElement).toHaveClass(
      "hidden",
      "lg:hidden",
    );
    expect(
      screen.getByRole("region", { name: "Workbench terminal" }),
    ).toHaveClass("flex", "flex-1");
    expect(
      screen.getByRole("region", { name: "Workbench terminal" }),
    ).not.toHaveClass("lg:flex-none");
    expect(document.querySelector("[data-workbench-agent-pane]")).toHaveClass(
      "hidden",
      "lg:hidden",
    );
    expect(screen.getByText("PTY surface")).toBe(terminalSurface);

    mockWorkbenchState = {
      bottomPanelOpen: true,
      agentPaneOpen: true,
      terminalFullscreen: false,
    };
    rerender(<ResponsiveSurfaces />);
    expect(screen.getByText("Editor").parentElement).toHaveClass("lg:flex");
    expect(screen.getByText("PTY surface")).toBe(terminalSurface);
  });
});
