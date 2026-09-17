import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { isSidebarTerminal, type SidebarContent } from "@/types/chat";

let mockSidebarOpen = false;
let mockSidebarContent: SidebarContent | null = null;
const mockOpenSidebar = jest.fn((content: SidebarContent) => {
  mockSidebarContent = content;
  mockSidebarOpen = true;
});
const mockCloseSidebar = jest.fn(() => {
  mockSidebarContent = null;
  mockSidebarOpen = false;
});
const mockUpdateSidebarContent = jest.fn();
const mockPublishLiveSidebarContent = jest.fn();

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    openSidebar: mockOpenSidebar,
    closeSidebar: mockCloseSidebar,
    sidebarOpen: mockSidebarOpen,
    sidebarContent: mockSidebarContent,
    updateSidebarContent: mockUpdateSidebarContent,
  }),
}));

jest.mock("@/app/contexts/LiveSidebarContent", () => ({
  usePublishLiveSidebarContent: () => mockPublishLiveSidebarContent,
}));

const { useToolSidebar } =
  jest.requireActual<typeof import("../useToolSidebar")>("../useToolSidebar");

const terminalContent = {
  command: "ls",
  output: "",
  isExecuting: false,
  toolCallId: "tool-1",
};

function ToolSidebarHarness({
  content = terminalContent,
}: {
  content?: SidebarContent;
}) {
  const { handleOpenInSidebar, handleKeyDown, isSidebarActive } =
    useToolSidebar({
      toolCallId: "tool-1",
      content,
      typeGuard: isSidebarTerminal,
    });

  return (
    <button
      type="button"
      data-active={isSidebarActive}
      onClick={handleOpenInSidebar}
      onKeyDown={handleKeyDown}
    >
      Open terminal
    </button>
  );
}

describe("useToolSidebar", () => {
  beforeEach(() => {
    mockSidebarOpen = false;
    mockSidebarContent = null;
    mockOpenSidebar.mockClear();
    mockCloseSidebar.mockClear();
    mockUpdateSidebarContent.mockClear();
    mockPublishLiveSidebarContent.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("closes the active computer sidebar with Escape from the tool trigger", () => {
    const { rerender } = render(<ToolSidebarHarness />);
    const button = screen.getByRole("button", { name: "Open terminal" });

    fireEvent.click(button);
    rerender(<ToolSidebarHarness />);

    expect(button).toHaveAttribute("data-active", "true");

    fireEvent.keyDown(button, { key: "Escape" });

    expect(mockCloseSidebar).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when the trigger is not the active sidebar content", () => {
    render(<ToolSidebarHarness />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Open terminal" }), {
      key: "Escape",
    });

    expect(mockCloseSidebar).not.toHaveBeenCalled();
  });

  it("keeps tool details closed until the user selects a tool", () => {
    render(<ToolSidebarHarness />);

    expect(mockOpenSidebar).not.toHaveBeenCalled();
    expect(mockPublishLiveSidebarContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));

    expect(mockOpenSidebar).toHaveBeenCalledWith(terminalContent);
    expect(mockPublishLiveSidebarContent).toHaveBeenCalledWith(terminalContent);
  });

  it("throttles live updates outside GlobalState and coalesces the latest chunk", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    mockSidebarOpen = true;
    mockSidebarContent = terminalContent;

    const { rerender } = render(
      <ToolSidebarHarness content={{ ...terminalContent, output: "first" }} />,
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(mockPublishLiveSidebarContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ output: "first" }),
    );
    expect(mockUpdateSidebarContent).not.toHaveBeenCalled();

    const callsAfterFirstChunk =
      mockPublishLiveSidebarContent.mock.calls.length;
    rerender(
      <ToolSidebarHarness content={{ ...terminalContent, output: "second" }} />,
    );
    rerender(
      <ToolSidebarHarness content={{ ...terminalContent, output: "latest" }} />,
    );

    act(() => {
      jest.advanceTimersByTime(49);
    });
    expect(mockPublishLiveSidebarContent).toHaveBeenCalledTimes(
      callsAfterFirstChunk,
    );

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockPublishLiveSidebarContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ output: "latest" }),
    );
    expect(mockUpdateSidebarContent).not.toHaveBeenCalled();
  });
});
