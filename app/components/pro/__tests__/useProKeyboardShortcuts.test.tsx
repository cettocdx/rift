import { fireEvent, render } from "@testing-library/react";
import { useProKeyboardShortcuts } from "../useProKeyboardShortcuts";

const routerPush = jest.fn();
const toggleChatSidebar = jest.fn();
const initializeNewChat = jest.fn();
const closeSidebar = jest.fn();
const toggleTerminalDock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    toggleChatSidebar,
    initializeNewChat,
    closeSidebar,
    toggleTerminalDock,
  }),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goHome: jest.fn() }),
}));

jest.mock("@/lib/utils/command-palette", () => ({
  openCommandPalette: jest.fn(),
}));

function ShortcutHarness() {
  useProKeyboardShortcuts();
  return (
    <div>
      <button type="button">Canvas</button>
      <div onKeyDown={(event) => event.stopPropagation()}>
        <button type="button">Propagation-blocking canvas</button>
      </div>
      <input aria-label="Input" />
      <textarea aria-label="Composer" />
      <div contentEditable role="textbox" aria-label="Content editor" />
      <div className="monaco-editor">
        <textarea aria-label="Editor" />
      </div>
      <div data-workbench-interactive-terminal>
        <textarea aria-label="Terminal input" />
      </div>
    </div>
  );
}

const originalPlatform = navigator.platform;
const setPlatform = (value: string) =>
  Object.defineProperty(navigator, "platform", { configurable: true, value });

const MODIFIER_CASES = [
  { modifier: "Command", platform: "MacIntel", event: { metaKey: true } },
  { modifier: "Control", platform: "Win32", event: { ctrlKey: true } },
] as const;

const EDITABLE_TARGET_CASES = MODIFIER_CASES.flatMap(
  ({ modifier, platform, event }) =>
    ["Input", "Composer", "Content editor", "Editor", "Terminal input"].map(
      (target) => ({ event, modifier, platform, target }),
    ),
);

describe("authenticated shell keyboard shortcuts", () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform("MacIntel");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
  });

  afterAll(() => {
    setPlatform(originalPlatform);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it.each(["n", "k"])(
    "preserves native macOS Control-%s while editing the composer",
    (key) => {
      const { getByRole } = render(<ShortcutHarness />);
      const unhandled = fireEvent.keyDown(
        getByRole("textbox", { name: "Composer" }),
        {
          key,
          ctrlKey: true,
        },
      );
      expect(unhandled).toBe(true);
      expect(initializeNewChat).not.toHaveBeenCalled();
      expect(closeSidebar).not.toHaveBeenCalled();
    },
  );

  it.each(MODIFIER_CASES)(
    "opens the terminal dock in place with $modifier-J",
    ({ event, platform }) => {
      setPlatform(platform);
      const { getByRole } = render(<ShortcutHarness />);

      const unhandled = fireEvent.keyDown(
        getByRole("button", { name: "Canvas" }),
        {
          key: "j",
          ...event,
        },
      );

      expect(unhandled).toBe(false);
      expect(toggleTerminalDock).toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalledWith("/workspace?terminal=focus");
    },
  );

  it.each(MODIFIER_CASES)(
    "handles $modifier-J before a non-editable widget stops propagation",
    ({ event, platform }) => {
      setPlatform(platform);
      const { getByRole } = render(<ShortcutHarness />);

      const unhandled = fireEvent.keyDown(
        getByRole("button", { name: "Propagation-blocking canvas" }),
        {
          key: "j",
          ...event,
        },
      );

      expect(unhandled).toBe(false);
      expect(toggleTerminalDock).toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalledWith("/workspace?terminal=focus");
    },
  );

  it.each(MODIFIER_CASES)(
    "keeps a single $modifier-J from toggling the dock twice",
    ({ event, platform }) => {
      setPlatform(platform);
      const downstreamWorkbenchKeydown = jest.fn();
      document.addEventListener("keydown", downstreamWorkbenchKeydown);

      try {
        const { getByRole } = render(<ShortcutHarness />);

        fireEvent.keyDown(getByRole("button", { name: "Canvas" }), {
          key: "j",
          ...event,
        });

        expect(toggleTerminalDock).toHaveBeenCalled();
        expect(routerPush).not.toHaveBeenCalledWith(
          "/workspace?terminal=focus",
        );
        expect(downstreamWorkbenchKeydown).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("keydown", downstreamWorkbenchKeydown);
      }
    },
  );

  it.each(EDITABLE_TARGET_CASES)(
    "opens the terminal with $modifier-J from the focused $target",
    ({ event, target, platform }) => {
      setPlatform(platform);
      const { getByRole } = render(<ShortcutHarness />);

      const unhandled = fireEvent.keyDown(
        getByRole("textbox", { name: target }),
        {
          key: "j",
          ...event,
        },
      );

      expect(unhandled).toBe(false);
      expect(toggleTerminalDock).toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalledWith("/workspace?terminal=focus");
    },
  );

  it.each(MODIFIER_CASES)(
    "ignores repeated $modifier-J keydown events",
    ({ event, platform }) => {
      setPlatform(platform);
      const { getByRole } = render(<ShortcutHarness />);

      const unhandled = fireEvent.keyDown(
        getByRole("button", { name: "Canvas" }),
        {
          key: "j",
          repeat: true,
          ...event,
        },
      );

      expect(unhandled).toBe(true);
      expect(routerPush).not.toHaveBeenCalled();
    },
  );

  it.each(MODIFIER_CASES)(
    "leaves $modifier-J untouched on mobile",
    ({ event, platform }) => {
      setPlatform(platform);
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 390,
      });
      const { getByRole } = render(<ShortcutHarness />);

      const unhandled = fireEvent.keyDown(
        getByRole("button", { name: "Canvas" }),
        {
          key: "j",
          ...event,
        },
      );

      expect(unhandled).toBe(true);
      expect(routerPush).not.toHaveBeenCalled();
    },
  );
});
