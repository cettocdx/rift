import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TerminalDock } from "../TerminalDock";

const mockSetOpen = jest.fn();
let mockOpen = true;
let mockMounts = 0;
let mockUnmounts = 0;
const mockResizeCallbacks = new Set<() => void>();

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    terminalDockOpen: mockOpen,
    setTerminalDockOpen: mockSetOpen,
  }),
}));
jest.mock("@/app/components/workbench/WorkbenchProvider", () => ({
  SandboxWorkbenchProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock("@/app/components/workbench/WorkbenchActivity", () => ({
  WorkbenchActivityProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock("@/app/components/workbench/WorkbenchTerminalPanel", () => ({
  WorkbenchTerminalPanel: function MockTerminal(props: {
    onRequestClose: () => void;
    onToggleFullscreen: () => void;
    hostFullscreen: boolean;
  }) {
    const ReactModule = require("react") as typeof React;
    ReactModule.useEffect(() => {
      mockMounts += 1;
      return () => {
        mockUnmounts += 1;
      };
    }, []);
    return (
      <div data-testid="terminal-session">
        <input aria-label="Terminal command" defaultValue="preserved command" />
        <button onClick={props.onRequestClose}>Close terminal</button>
        <button onClick={props.onToggleFullscreen}>
          {props.hostFullscreen ? "Restore terminal" : "Maximize terminal"}
        </button>
      </div>
    );
  },
}));

const rect = (x = 600, y = 80, width = 400, height = 500): DOMRect => ({
  x,
  y,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  width,
  height,
  toJSON: () => ({}),
});
let host: HTMLDivElement | null = null;
const surfaces: HTMLElement[] = [];
function addSurface(attribute: string, bounds: DOMRect) {
  const surface = document.createElement("div");
  surface.setAttribute(
    attribute,
    attribute === "data-rift-native-titlebar" ? "window" : "",
  );
  surface.getBoundingClientRect = jest.fn(() => bounds);
  document.body.append(surface);
  surfaces.push(surface);
  return surface;
}
function pointer(target: EventTarget, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}
function addHost(active = true) {
  host = document.createElement("div");
  host.setAttribute("data-rift-terminal-host", "");
  host.dataset.active = String(active);
  host.getBoundingClientRect = jest.fn(() => rect());
  document.body.append(host);
  return host;
}
function dock() {
  return document.querySelector('[data-ui="terminal-dock"]') as HTMLElement;
}

beforeEach(() => {
  mockOpen = true;
  mockSetOpen.mockClear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  mockMounts = 0;
  mockUnmounts = 0;
  localStorage.clear();
  mockResizeCallbacks.clear();
  global.ResizeObserver = class {
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      mockResizeCallbacks.add(callback);
    }
    observe() {
      mockResizeCallbacks.add(this.callback);
    }
    unobserve() {}
    disconnect() {
      mockResizeCallbacks.delete(this.callback);
    }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  host?.remove();
  host = null;
  surfaces.splice(0).forEach((surface) => surface.remove());
  document.documentElement.style.cursor = "";
  document.documentElement.style.userSelect = "";
});

describe("persistent terminal dock host", () => {
  it("does not measure or observe layout while closed, then follows the host on reopen", async () => {
    const surface = addSurface("data-rift-main-panel", rect(0, 80, 1000, 600));
    mockOpen = false;
    const view = render(<TerminalDock />);
    expect(surface.getBoundingClientRect).not.toHaveBeenCalled();
    expect(mockResizeCallbacks.size).toBe(0);
    mockOpen = true;
    view.rerender(<TerminalDock />);
    await waitFor(() => expect(surface.getBoundingClientRect).toHaveBeenCalled());
    const session = screen.getByTestId("terminal-session");
    mockOpen = false;
    view.rerender(<TerminalDock />);
    expect(mockResizeCallbacks.size).toBe(0);
    mockOpen = true;
    addHost();
    view.rerender(<TerminalDock />);
    await waitFor(() => expect(dock()).toHaveAttribute("data-embedded", "true"));
    expect(screen.getByTestId("terminal-session")).toBe(session);
  });

  it("fits the active host instead of covering the full window bottom", async () => {
    addHost();
    render(<TerminalDock />);
    await waitFor(() =>
      expect(dock()).toHaveStyle({
        top: "80px",
        left: "600px",
        width: "400px",
        height: "500px",
      }),
    );
    expect(dock()).toHaveAttribute("data-embedded", "true");
    expect(
      screen.queryByRole("separator", { name: "Resize terminal" }),
    ).not.toBeInTheDocument();
    host!.getBoundingClientRect = jest.fn(() => rect(280, 420, 720, 300));
    act(() => mockResizeCallbacks.forEach((callback) => callback()));
    await waitFor(() =>
      expect(dock()).toHaveStyle({
        top: "420px",
        left: "280px",
        width: "720px",
        height: "300px",
      }),
    );
  });

  it("hides inactive tabs and restores the exact same terminal DOM and session", async () => {
    addHost();
    const view = render(<TerminalDock />);
    const session = screen.getByTestId("terminal-session");
    const input = screen.getByLabelText("Terminal command");
    fireEvent.change(input, { target: { value: "work in progress" } });
    act(() => {
      host!.dataset.active = "false";
    });
    await waitFor(() => expect(dock()).toHaveAttribute("aria-hidden", "true"));
    expect(dock()).toHaveAttribute("inert");
    expect(dock()).toHaveStyle({ visibility: "hidden" });
    act(() => {
      host!.dataset.active = "true";
    });
    await waitFor(() => expect(dock()).toHaveAttribute("aria-hidden", "false"));
    mockOpen = false;
    view.rerender(<TerminalDock />);
    expect(dock()).toHaveAttribute("inert");
    mockOpen = true;
    view.rerender(<TerminalDock />);
    expect(screen.getByTestId("terminal-session")).toBe(session);
    expect(input).toHaveValue("work in progress");
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
  });

  it("keeps a terminal mounted when a host appears, disappears, and returns", async () => {
    render(<TerminalDock />);
    const session = screen.getByTestId("terminal-session");
    expect(
      screen.getByRole("separator", { name: "Resize terminal" }),
    ).toBeInTheDocument();
    act(() => {
      addHost();
    });
    await waitFor(() =>
      expect(dock()).toHaveAttribute("data-embedded", "true"),
    );
    act(() => {
      host!.remove();
    });
    await waitFor(() =>
      expect(dock()).toHaveAttribute("data-embedded", "false"),
    );
    expect(
      screen.getByRole("separator", { name: "Resize terminal" }),
    ).toBeInTheDocument();
    act(() => {
      document.body.append(host!);
    });
    await waitFor(() =>
      expect(dock()).toHaveAttribute("data-embedded", "true"),
    );
    expect(screen.getByTestId("terminal-session")).toBe(session);
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
  });

  it("does not expose a zero-size host even if selected", async () => {
    addHost();
    host!.getBoundingClientRect = jest.fn(() => rect(0, 0, 0, 0));
    render(<TerminalDock />);
    await waitFor(() => expect(dock()).toHaveAttribute("aria-hidden", "true"));
  });

  it("routes embedded close, escape, and fullscreen controls to the workbench", async () => {
    addHost();
    const hide = jest.fn();
    const maximize = jest.fn();
    window.addEventListener("rift:hide-workbench", hide);
    window.addEventListener("rift:maximize-workbench", maximize);
    render(<TerminalDock />);
    await waitFor(() =>
      expect(dock()).toHaveAttribute("data-embedded", "true"),
    );
    fireEvent.click(screen.getByText("Maximize terminal"));
    expect(maximize).toHaveBeenCalledTimes(1);
    act(() => {
      host!.dataset.maximized = "true";
    });
    await screen.findByText("Restore terminal");
    fireEvent.click(screen.getByText("Close terminal"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hide).toHaveBeenCalledTimes(2);
    window.removeEventListener("rift:hide-workbench", hide);
    window.removeEventListener("rift:maximize-workbench", maximize);
  });

  it("does not mount a terminal before it has been requested", () => {
    mockOpen = false;
    addHost();
    render(<TerminalDock />);
    expect(screen.queryByTestId("terminal-session")).not.toBeInTheDocument();
    expect(mockMounts).toBe(0);
  });
});

describe("right-side terminal fallback", () => {
  it("opens beside the main content below native chrome, never across the sidebar", () => {
    addSurface("data-rift-main-panel", rect(280, 0, 920, 800));
    addSurface("data-rift-native-titlebar", rect(0, 0, 1200, 44));
    render(<TerminalDock />);
    expect(dock()).toHaveAttribute("data-placement", "right");
    expect(dock()).toHaveAttribute("data-embedded", "false");
    expect(dock()).toHaveStyle({
      top: "44px",
      left: "786px",
      width: "414px",
      height: "756px",
    });
    expect(
      screen.getByRole("separator", { name: "Resize terminal" }),
    ).toHaveAttribute("aria-orientation", "vertical");
  });

  it("resizes from its left edge and remembers only the width while retaining the session", () => {
    render(<TerminalDock />);
    const session = screen.getByTestId("terminal-session");
    const handle = screen.getByRole("separator", { name: "Resize terminal" });
    Object.defineProperty(handle, "setPointerCapture", { value: jest.fn() });
    pointer(handle, "pointerdown", 660);
    pointer(window, "pointermove", 560);
    expect(dock()).toHaveStyle({ left: "560px", width: "640px" });
    pointer(window, "pointerup", 560);
    expect(localStorage.getItem("rift:terminal-dock:width:v1")).toBe("640");
    expect(localStorage.getItem("rift:terminal-dock:height:v1")).toBeNull();
    expect(document.documentElement.style.cursor).toBe("");
    expect(screen.getByTestId("terminal-session")).toBe(session);
    expect(mockMounts).toBe(1);
    expect(mockUnmounts).toBe(0);
  });

  it("supports keyboard resizing and returns from fullscreen to the chosen width", () => {
    render(<TerminalDock />);
    const session = screen.getByTestId("terminal-session");
    const handle = screen.getByRole("separator", { name: "Resize terminal" });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(dock()).toHaveStyle({ width: "320px" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(dock()).toHaveStyle({ width: "340px" });
    fireEvent.click(screen.getByText("Maximize terminal"));
    expect(dock()).toHaveStyle({
      left: "0px",
      width: "1200px",
      height: "800px",
    });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore terminal"));
    expect(dock()).toHaveStyle({ left: "860px", width: "340px" });
    expect(screen.getByTestId("terminal-session")).toBe(session);
  });

  it("uses the available mobile width and keeps the app bar accessible", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    addSurface("data-pro-mobile-app-bar", rect(0, 0, 390, 52));
    render(<TerminalDock />);
    expect(dock()).toHaveStyle({
      top: "52px",
      left: "0px",
      width: "390px",
      height: "748px",
    });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("cancels a drag without changing the remembered size", () => {
    localStorage.setItem("rift:terminal-dock:width:v1", "500");
    render(<TerminalDock />);
    const handle = screen.getByRole("separator", { name: "Resize terminal" });
    Object.defineProperty(handle, "setPointerCapture", { value: jest.fn() });
    pointer(handle, "pointerdown", 700);
    pointer(window, "pointermove", 550);
    pointer(window, "pointercancel", 550);
    expect(dock()).toHaveStyle({ width: "500px" });
    expect(localStorage.getItem("rift:terminal-dock:width:v1")).toBe("500");
    expect(document.documentElement.style.userSelect).toBe("");
  });

  it("leaves Escape to terminal applications, editors, and open pickers", () => {
    render(<TerminalDock />);
    fireEvent.keyDown(screen.getByLabelText("Terminal command"), {
      key: "Escape",
    });
    for (const attribute of [
      "data-workbench-interactive-terminal",
      "contenteditable",
      "role",
    ]) {
      const surface = addSurface(attribute, rect());
      if (attribute === "contenteditable")
        surface.setAttribute(attribute, "true");
      if (attribute === "role") surface.setAttribute(attribute, "menu");
      const child = document.createElement("span");
      surface.append(child);
      fireEvent.keyDown(child, { key: "Escape" });
    }
    expect(mockSetOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Escape" });
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });
});
