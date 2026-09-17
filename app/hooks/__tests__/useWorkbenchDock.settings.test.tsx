import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";
import { useWorkbenchDock } from "../useWorkbenchDock";
import { terminalDockPresentationKey } from "../useTerminalDockPresentation";

let mockPathname = "/c/chat-one";
let mockAccount: string | null = "account-a";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(async () => undefined),
  useQuery: () => undefined,
}));
jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAccount ? { id: mockAccount } : null,
    loading: false,
    isAuthenticated: !!mockAccount,
    entitlements: [],
    entitlementsReady: true,
  }),
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function DockProbe() {
  const dock = useWorkbenchDock(mockPathname, true);
  const global = useGlobalState();
  return (
    <>
      <button
        onClick={() => {
          dock.openKind("terminal");
          global.setTerminalDockView("terminal");
        }}
      >
        Open terminal
      </button>
      <button onClick={dock.hide}>Hide terminal</button>
      <output data-testid="dock">
        {JSON.stringify({
          visible: dock.state.visible,
          active: dock.state.activeTabId,
          view: global.terminalDockView,
        })}
      </output>
    </>
  );
}
function PresentationProbe() {
  const global = useGlobalState();
  return <output data-testid="open">{String(global.terminalDockOpen)}</output>;
}
function App() {
  return (
    <GlobalStateProvider>
      <PresentationProbe />
      {!mockPathname.includes("/settings") && <DockProbe />}
    </GlobalStateProvider>
  );
}
function navigate(path: string, rerender: (ui: React.ReactNode) => void) {
  act(() => {
    mockPathname = path;
    rerender(<App />);
  });
}
const dock = () => JSON.parse(screen.getByTestId("dock").textContent!);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mockPathname = "/c/chat-one";
  mockAccount = "account-a";
});

it("restores the open terminal after Settings unmounts and remounts the workbench", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Open terminal"));
  expect(dock()).toEqual({
    visible: true,
    active: "terminal",
    view: "terminal",
  });
  navigate("/settings/general", app.rerender);
  expect(screen.getByTestId("open")).toHaveTextContent("false");
  navigate("/settings/appearance", app.rerender);
  navigate("/c/chat-one", app.rerender);
  expect(dock()).toEqual({
    visible: true,
    active: "terminal",
    view: "terminal",
  });
});

it.each([true, false])(
  "retains an explicitly open=%s dock through a renderer reload in Settings",
  (open) => {
    const first = render(<App />);
    fireEvent.click(screen.getByText("Open terminal"));
    if (!open) fireEvent.click(screen.getByText("Hide terminal"));
    navigate("/settings/general", first.rerender);
    first.unmount();
    const restored = render(<App />);
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    navigate("/c/chat-one", restored.rerender);
    expect(dock()).toMatchObject({ visible: open, view: "terminal" });
    expect(
      JSON.parse(
        sessionStorage.getItem(terminalDockPresentationKey("account-a"))!,
      ),
    ).toMatchObject({ pathname: "/c/chat-one", open });
  },
);

it("does not reopen on another chat after Settings", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Open terminal"));
  navigate("/settings/general", app.rerender);
  navigate("/c/chat-two", app.rerender);
  expect(dock().visible).toBe(false);
});

it("does not show another account's suspended dock after switching accounts in Settings", () => {
  const app = render(<App />);
  fireEvent.click(screen.getByText("Open terminal"));
  navigate("/settings/general", app.rerender);
  act(() => {
    mockAccount = "account-b";
    app.rerender(<App />);
  });
  navigate("/c/chat-one", app.rerender);
  expect(dock()).toMatchObject({ visible: false, view: "agent" });
  act(() => {
    mockAccount = "account-a";
    app.rerender(<App />);
  });
  expect(dock()).toMatchObject({ visible: true, view: "terminal" });
});
