import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { type ReactNode, useCallback } from "react";
import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";
import { useWorkbenchDock } from "@/app/hooks/useWorkbenchDock";
import { useMobileAgentActivity } from "../AgentWorkingTray";
import { AgentActivityPanel } from "../../AgentActivityPanel";
import { openAgentActivity } from "@/lib/workbench/events";
jest.mock("next/navigation", () => ({ usePathname: () => "/c/chat-one" }));
jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(),
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
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const openSpy = jest.fn();
const messages = [
  { id: "user", role: "user", parts: [] },
  {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "tool-delegate_task",
        toolCallId: "exact-one",
        state: "output-available",
        input: { name: "Ada", task: "Inspect focus" },
        output: {
          ok: true,
          agent: { status: "completed" },
          summary: "Exact one result",
        },
      },
      {
        type: "tool-delegate_task",
        toolCallId: "exact-two",
        state: "output-available",
        input: { name: "Lin", task: "Inspect layout" },
        output: {
          ok: true,
          agent: { status: "completed" },
          summary: "Exact two result",
        },
      },
    ],
  },
];
function Harness({ mobile, chatId }: { mobile: boolean; chatId: string }) {
  const dock = useWorkbenchDock(chatId, !mobile);
  const global = useGlobalState();
  const { setSidebarContent, setSidebarOpen, setBuildPreviewOpen } = global;
  const open = useCallback(() => {
    openSpy();
    setSidebarContent(null);
    setSidebarOpen(true);
    setBuildPreviewOpen(false);
  }, [setSidebarContent, setSidebarOpen, setBuildPreviewOpen]);
  useMobileAgentActivity({
    enabled: mobile,
    onSelectAgent: dock.selectAgent,
    onOpenActivity: open,
  });
  return (
    <>
      <textarea aria-label="Draft" />
      <button onClick={() => global.setSidebarOpen(false)}>Close</button>
      <output data-testid="selection">{dock.selectedAgent ?? "none"}</output>
      {global.sidebarOpen && (
        <AgentActivityPanel
          messages={messages}
          status="ready"
          todos={[]}
          toolExecutions={[]}
          selectedSubagentToolCallId={dock.selectedAgent}
          onSelectSubagent={dock.selectAgent}
        />
      )}
    </>
  );
}
function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}
beforeEach(() => openSpy.mockClear());
it.each([true, false])(
  "opens exact invocation for mobile=%s and clears selection when chat changes",
  async (mobile) => {
    const view = render(<Harness mobile={mobile} chatId="chat-one" />, {
      wrapper,
    });
    act(() => openAgentActivity({ toolCallId: "exact-two" }));
    await waitFor(() =>
      expect(screen.getByTestId("selection")).toHaveTextContent("exact-two"),
    );
    expect(screen.getByText("Exact two result")).toBeInTheDocument();
    expect(screen.queryByText("Exact one result")).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledTimes(mobile ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    screen.getByRole("textbox").focus();
    view.rerender(<Harness mobile={mobile} chatId="chat-two" />);
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.queryByText("Exact two result")).not.toBeInTheDocument();
    view.unmount();
    openSpy.mockClear();
    act(() => openAgentActivity({ toolCallId: "exact-one" }));
    expect(openSpy).not.toHaveBeenCalled();
  },
);
