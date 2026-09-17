import { fireEvent, render } from "@testing-library/react";
import { useWorkbenchKeyboardShortcuts } from "../useWorkbenchKeyboardShortcuts";

const toggleSidebar = jest.fn();
const toggleBottomPanel = jest.fn();
const toggleTerminalFullscreen = jest.fn();

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    actions: {
      toggleSidebar,
      toggleBottomPanel,
      toggleTerminalFullscreen,
    },
  }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat: jest.fn(),
    closeSidebar: jest.fn(),
  }),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goHome: jest.fn() }),
}));

function ShortcutHarness() {
  useWorkbenchKeyboardShortcuts();
  return <div data-workbench-interactive-terminal>Terminal target</div>;
}

describe("Workbench terminal keyboard shortcuts", () => {
  const originalPlatform = navigator.platform;
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    toggleSidebar.mockClear();
    toggleBottomPanel.mockClear();
    toggleTerminalFullscreen.mockClear();
  });

  afterAll(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("uses Command+Shift+J for full screen and Command+J for panel visibility", () => {
    render(<ShortcutHarness />);

    fireEvent.keyDown(document, { key: "j", metaKey: true, shiftKey: true });
    expect(toggleTerminalFullscreen).toHaveBeenCalledTimes(1);
    expect(toggleBottomPanel).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "j", metaKey: true });
    expect(toggleBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("does not steal terminal Ctrl chords", () => {
    const { getByText } = render(<ShortcutHarness />);
    fireEvent.keyDown(getByText("Terminal target"), {
      key: "j",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(toggleTerminalFullscreen).not.toHaveBeenCalled();
  });
});
