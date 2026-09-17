import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";
import { useWorkbenchDock } from "@/app/hooks/useWorkbenchDock";
import { AgentRunSummaryBar } from "../AgentRunSummaryBar";

let mockAccountId: string | null = null;

jest.mock("next/navigation", () => ({ usePathname: () => "/c/strip-chat" }));
jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(async () => undefined),
  useQuery: () => undefined,
}));
jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAccountId ? { id: mockAccountId } : null,
    loading: false,
    isAuthenticated: false,
    entitlements: [],
    entitlementsReady: true,
  }),
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function DockStrip() {
  const global = useGlobalState();
  const dock = useWorkbenchDock("strip-chat", true);
  const active = dock.state.tabs.find(
    (tab) => tab.id === dock.state.activeTabId,
  );
  return (
    <>
      <button
        onClick={() => global.setBuildPreviewUrl("https://preview.example")}
      >
        Receive preview
      </button>
      <AgentRunSummaryBar
        todos={[]}
        toolExecutions={[]}
        status="ready"
        panelOpen={dock.state.visible}
        onTogglePanel={dock.toggle}
        onOpenBrowser={() => dock.openKind("browser")}
        onTogglePreview={
          global.buildPreviewUrl
            ? () =>
                dock.state.visible && dock.state.activeTabId === "preview"
                  ? dock.hide()
                  : dock.openKind("preview")
            : undefined
        }
        previewOpen={global.buildPreviewOpen}
        onToggleTerminal={() =>
          dock.state.visible && active?.kind === "terminal"
            ? dock.hide()
            : dock.openKind("terminal")
        }
        terminalOpen={global.terminalDockOpen}
      />
      <output aria-label="Active dock surface">{active?.kind ?? "none"}</output>
      <output aria-label="Dock visibility">{String(dock.state.visible)}</output>
      <output aria-label="Selected terminal view">
        {global.terminalDockView}
      </output>
      <output aria-label="Open tab count">{dock.state.tabs.length}</output>
    </>
  );
}
function setup() {
  return render(
    <GlobalStateProvider>
      <DockStrip />
    </GlobalStateProvider>,
  );
}

describe("workspace strip and preview dock behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockAccountId = null;
  });

  it("reconstructs the terminal workspace pane from account-scoped reload presentation", async () => {
    mockAccountId = "account-a";
    sessionStorage.setItem(
      "rift:terminal-presentation:v1:account-a",
      JSON.stringify({
        version: 1,
        pathname: "/c/strip-chat",
        open: true,
        view: "terminal",
      }),
    );
    setup();
    await waitFor(() =>
      expect(screen.getByLabelText("Dock visibility")).toHaveTextContent(
        "true",
      ),
    );
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "terminal",
    );
    expect(screen.getByLabelText("Selected terminal view")).toHaveTextContent(
      "terminal",
    );
  });

  it("offers preview only after a real URL arrives, without automatically opening it", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Show preview" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Receive preview" }));
    expect(screen.getByLabelText("Dock visibility")).toHaveTextContent("false");
    const preview = screen.getByRole("button", { name: "Show preview" });
    fireEvent.click(preview);
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "preview",
    );
    expect(
      screen.getByRole("button", { name: "Hide preview" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("switches preview, browser, and terminal from the strip while retaining their tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Receive preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "browser",
    );
    expect(
      screen.getByRole("button", { name: "Show preview" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show terminal" }));
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "terminal",
    );
    expect(screen.getByLabelText("Open tab count")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "preview",
    );
    expect(screen.getByLabelText("Open tab count")).toHaveTextContent("3");
  });

  it("honors the visible Hide preview control without destroying the preview tab", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Receive preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.getByLabelText("Dock visibility")).toHaveTextContent("false");
    expect(screen.getByLabelText("Open tab count")).toHaveTextContent("1");
  });

  it("hides and restores the selected terminal through the strip without destroying its tab", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Show terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal" }));
    expect(screen.getByLabelText("Dock visibility")).toHaveTextContent("false");
    expect(screen.getByLabelText("Open tab count")).toHaveTextContent("1");
    fireEvent.click(
      screen.getByRole("button", { name: "Show agent activity" }),
    );
    expect(screen.getByLabelText("Dock visibility")).toHaveTextContent("true");
    expect(screen.getByLabelText("Active dock surface")).toHaveTextContent(
      "terminal",
    );
    expect(screen.getByLabelText("Open tab count")).toHaveTextContent("1");
  });
});
