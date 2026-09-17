import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentRunSummaryBar } from "../AgentRunSummaryBar";
import { prepareWorkbenchPanel } from "../workbench/prepare-panel";
jest.mock("../workbench/prepare-panel", () => ({ prepareWorkbenchPanel: jest.fn() }));

const base = {
  todos: [],
  toolExecutions: [],
  messages: [],
  status: "ready" as const,
  panelOpen: false,
  onTogglePanel: jest.fn(),
};

const withRun = {
  ...base,
  todos: [{ id: "1", content: "step", status: "completed" as const }],
};

describe("the workspace strip", () => {
  beforeEach(() => jest.clearAllMocks());
  it("prepares an intended panel without opening it or starting work", () => {
    render(<AgentRunSummaryBar {...base} panelDestination="workspace" onToggleTerminal={jest.fn()} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Show workspace panel" }));
    expect(prepareWorkbenchPanel).toHaveBeenCalledWith("activity");
    fireEvent.focus(screen.getByRole("button", { name: "Show terminal" }));
    expect(prepareWorkbenchPanel).toHaveBeenCalledWith("terminal");
    expect(base.onTogglePanel).not.toHaveBeenCalled();
  });

  it("offers terminal, preview and activity as icon controls", () => {
    render(
      <AgentRunSummaryBar
        {...withRun}
        onToggleTerminal={jest.fn()}
        onTogglePreview={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show preview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show agent activity" }),
    ).toBeInTheDocument();
  });

  it("omits the preview control entirely when there is no preview to show", () => {
    // A control that cannot do anything is worse than a missing one.
    render(<AgentRunSummaryBar {...withRun} onToggleTerminal={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });

  it("keeps the panel toggles available after a run ends", () => {
    // These are workspace controls, not run status. Hiding them the moment a
    // run finished is why the row kept disappearing.
    render(<AgentRunSummaryBar {...base} onToggleTerminal={jest.fn()} />);
    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toBeInTheDocument();
  });

  it("keeps Activity discoverable even without tool operations", () => {
    render(<AgentRunSummaryBar {...base} />);
    const toggle = screen.getByRole("button", { name: "Show agent activity" });
    expect(toggle).toHaveTextContent(/^$/);
    expect(toggle).toHaveAttribute("title", "Show agent activity");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(base.onTogglePanel).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(base.onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it("stays visible while the activity panel is open, and says so", () => {
    // The old bar removed itself once the panel opened, so there was no way
    // back out from the strip.
    render(
      <AgentRunSummaryBar
        {...withRun}
        panelOpen
        onToggleTerminal={jest.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Hide agent activity" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps Activity available without automatically opening it on submit", () => {
    render(
      <AgentRunSummaryBar
        {...base}
        status="submitted"
        onToggleTerminal={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show agent activity" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(base.onTogglePanel).not.toHaveBeenCalled();
  });

  it("allows closing an already-open panel even after an empty run fails", () => {
    render(<AgentRunSummaryBar {...base} status="error" panelOpen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Hide agent activity" }),
    );
    expect(base.onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it("reports open state on each control for assistive tech", () => {
    render(
      <AgentRunSummaryBar
        {...withRun}
        onToggleTerminal={jest.fn()}
        onTogglePreview={jest.fn()}
        terminalOpen
        previewOpen
      />,
    );
    expect(
      screen.getByRole("button", { name: "Hide terminal" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Hide preview" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("invokes the handler behind each control", () => {
    const onToggleTerminal = jest.fn();
    const onTogglePreview = jest.fn();
    const onTogglePanel = jest.fn();
    render(
      <AgentRunSummaryBar
        {...withRun}
        onTogglePanel={onTogglePanel}
        onToggleTerminal={onToggleTerminal}
        onTogglePreview={onTogglePreview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Show agent activity" }),
    );

    expect(onToggleTerminal).toHaveBeenCalledTimes(1);
    expect(onTogglePreview).toHaveBeenCalledTimes(1);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });
  /*
   * Where the controls live.
   *
   * On a window wide enough to have a title strip they belong IN the strip --
   * it is a full-width drag overlay, so anything rendered underneath it is not
   * clickable, which is how these three buttons came to do nothing at all.
   * Below the breakpoint the strip is display:none, so portalling there would
   * hand them to a hidden container and they would vanish instead.
   */
  function setViewport(wide: boolean) {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: wide && query.includes("768px"),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  }

  it("puts its controls inside the strip, where they are clickable", () => {
    setViewport(true);
    const slot = document.createElement("div");
    slot.id = "rift-window-actions-slot";
    document.body.appendChild(slot);
    const onToggleTerminal = jest.fn();

    render(
      <AgentRunSummaryBar {...withRun} onToggleTerminal={onToggleTerminal} />,
    );

    const terminal = screen.getByRole("button", { name: "Show terminal" });
    expect(slot).toContainElement(terminal);
    fireEvent.click(terminal);
    expect(onToggleTerminal).toHaveBeenCalledTimes(1);

    slot.remove();
  });

  it("moves Activity into the titlebar when the shell mounts after the chat", async () => {
    setViewport(true);
    render(<AgentRunSummaryBar {...base} />);
    const slot = document.createElement("div");
    slot.id = "rift-window-actions-slot";
    document.body.appendChild(slot);
    await waitFor(() =>
      expect(slot).toContainElement(
        screen.getByRole("button", { name: "Show agent activity" }),
      ),
    );
    slot.remove();
  });

  it("keeps the controls in the flow on a window with no strip", () => {
    setViewport(false);
    const slot = document.createElement("div");
    slot.id = "rift-window-actions-slot";
    document.body.appendChild(slot);

    render(<AgentRunSummaryBar {...withRun} onToggleTerminal={jest.fn()} />);

    expect(slot).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toBeInTheDocument();

    slot.remove();
  });
});

describe("single owner for workspace panel controls", () => {
  it("removes the launcher controls while the desktop dock owns the header", () => {
    const { rerender } = render(
      <AgentRunSummaryBar
        {...base}
        panelDestination="workspace"
        panelOpen
        onOpenBrowser={jest.fn()}
        onTogglePreview={jest.fn()}
        previewOpen
        onToggleTerminal={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Hide workspace panel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hide preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open browser" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show terminal" }),
    ).not.toBeInTheDocument();
    rerender(
      <AgentRunSummaryBar
        {...base}
        panelDestination="workspace"
        onTogglePreview={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show workspace panel" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Show preview" })).toBeVisible();
  });
  it("keeps the close action for an activity surface without a desktop dock", () => {
    render(
      <AgentRunSummaryBar {...base} panelDestination="activity" panelOpen />,
    );
    expect(
      screen.getByRole("button", { name: "Hide agent activity" }),
    ).toBeVisible();
  });
});
