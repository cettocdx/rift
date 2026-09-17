import { fireEvent, render, screen } from "@testing-library/react";
import { useWorkbench, WorkbenchProvider } from "../WorkbenchProvider";
import type { WorkbenchAdapter } from "../types";

const adapter: WorkbenchAdapter = {
  listDirectory: jest.fn<WorkbenchAdapter["listDirectory"]>(),
  readFile: jest.fn<WorkbenchAdapter["readFile"]>(),
  writeFile: jest.fn<WorkbenchAdapter["writeFile"]>(),
  readGit: jest.fn<WorkbenchAdapter["readGit"]>(),
  readGitDiff: jest.fn<WorkbenchAdapter["readGitDiff"]>(),
  mutateGit: jest.fn<WorkbenchAdapter["mutateGit"]>(),
};

function FullscreenProbe() {
  const { state, actions } = useWorkbench();
  return (
    <div>
      <output data-testid="layout-state">
        {JSON.stringify({
          panel: state.bottomPanelOpen,
          fullscreen: state.terminalFullscreen,
          sidebar: state.sidebarOpen,
          agent: state.agentPaneOpen,
        })}
      </output>
      <button type="button" onClick={actions.toggleBottomPanel}>
        Toggle panel
      </button>
      <button type="button" onClick={actions.enterTerminalFullscreen}>
        Enter full screen
      </button>
      <button type="button" onClick={actions.exitTerminalFullscreen}>
        Exit full screen
      </button>
    </div>
  );
}

function expectLayout(value: {
  panel: boolean;
  fullscreen: boolean;
  sidebar: boolean;
  agent: boolean;
}) {
  expect(screen.getByTestId("layout-state")).toHaveTextContent(
    JSON.stringify(value),
  );
}

describe("WorkbenchProvider terminal full screen", () => {
  it("restores a previously closed terminal panel and preserves pane choices", () => {
    render(
      <WorkbenchProvider adapter={adapter}>
        <FullscreenProbe />
      </WorkbenchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
    expectLayout({
      panel: false,
      fullscreen: false,
      sidebar: true,
      agent: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
    expectLayout({
      panel: true,
      fullscreen: true,
      sidebar: true,
      agent: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expectLayout({
      panel: false,
      fullscreen: false,
      sidebar: true,
      agent: true,
    });
  });

  it("returns to an open terminal panel when it started open", () => {
    render(
      <WorkbenchProvider adapter={adapter}>
        <FullscreenProbe />
      </WorkbenchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expectLayout({
      panel: true,
      fullscreen: false,
      sidebar: true,
      agent: true,
    });
  });
});
