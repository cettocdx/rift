import { act, render, waitFor } from "@testing-library/react";
import { useProKeyboardShortcuts } from "../useProKeyboardShortcuts";

const mockNewChat = jest.fn();
const mockGoHome = jest.fn();
const mockCloseSidebar = jest.fn();
const mockSettings = jest.fn();
const mockSearch = jest.fn();
const mockListen = jest.fn();
const mockStop = jest.fn();
let mockNative = true;

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockNative,
}));
jest.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat: mockNewChat,
    closeSidebar: mockCloseSidebar,
  }),
}));
jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goHome: mockGoHome }),
}));
jest.mock("@/app/components/settings/useSettingsNavigation", () => ({
  useSettingsNavigation: () => ({ openSettings: mockSettings }),
}));
jest.mock("@/lib/utils/command-palette", () => ({
  openCommandPalette: () => mockSearch(),
}));

function Harness() {
  useProKeyboardShortcuts();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative = true;
  mockListen.mockResolvedValue(mockStop);
});

it("routes native menu commands without needing a main-document key event", async () => {
  render(<Harness />);
  await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));
  expect(mockListen.mock.calls[0][0]).toBe("rift:desktop-menu-action");
  const deliver = mockListen.mock.calls[0][1];
  act(() => {
    deliver({ payload: { action: "new-chat" } });
    deliver({ payload: { action: "search" } });
    deliver({ payload: { action: "settings" } });
    deliver({ payload: { action: "unknown" } });
  });
  expect(mockNewChat).toHaveBeenCalledTimes(1);
  expect(mockCloseSidebar).toHaveBeenCalledTimes(1);
  expect(mockGoHome).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSettings).toHaveBeenCalledTimes(1);
});

it("unsubscribes on unmount and ignores any queued event", async () => {
  const view = render(<Harness />);
  await waitFor(() => expect(mockListen).toHaveBeenCalled());
  const deliver = mockListen.mock.calls[0][1];
  view.unmount();
  expect(mockStop).toHaveBeenCalledTimes(1);
  deliver({ payload: { action: "new-chat" } });
  expect(mockNewChat).not.toHaveBeenCalled();
});

it("cleans a native listener that finishes registering after unmount", async () => {
  let finish!: (stop: () => void) => void;
  mockListen.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Harness />);
  await waitFor(() => expect(mockListen).toHaveBeenCalled());
  view.unmount();
  await act(async () => {
    finish(mockStop);
  });
  expect(mockStop).toHaveBeenCalledTimes(1);
});

it("keeps web clients independent of the native event bridge", async () => {
  mockNative = false;
  render(<Harness />);
  await act(async () => {});
  expect(mockListen).not.toHaveBeenCalled();
});
