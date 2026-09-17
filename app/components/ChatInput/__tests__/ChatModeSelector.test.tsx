import { fireEvent, render, screen } from "@testing-library/react";

import { ChatModeSelector } from "../ChatModeSelector";

const mockSetChatMode = jest.fn();
const mockSetSandboxPreference = jest.fn();
const mockSetSelectedModel = jest.fn();
const mockGlobalState = {
  chatMode: "ask",
  setChatMode: mockSetChatMode,
  chatPurpose: "app",
  temporaryChatsEnabled: false,
  hasLocalSandbox: true,
  defaultLocalSandboxPreference: "local",
  sandboxPreference: "e2b",
  setSandboxPreference: mockSetSandboxPreference,
  selectedModel: "build-grok",
  setSelectedModel: mockSetSelectedModel,
};

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => mockGlobalState,
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

jest.mock("@/app/hooks/useTauri", () => ({
  navigateToAuth: jest.fn(),
}));

describe("ChatModeSelector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGlobalState.sandboxPreference = "e2b";
  });

  it("preserves the selected Build model when Plan switches to Build", async () => {
    render(<ChatModeSelector />);

    const trigger = screen.getByRole("button", { name: "Chat mode: Plan" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Build" }));

    expect(mockSetChatMode).toHaveBeenCalledWith("agent");
    expect(mockSetSandboxPreference).not.toHaveBeenCalled();
    expect(mockSetSelectedModel).not.toHaveBeenCalled();
  });

  it("preserves the selected computer when switching Plan to Build", async () => {
    mockGlobalState.sandboxPreference = "my-mac";
    render(<ChatModeSelector />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Chat mode: Plan" }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Build" }));
    expect(mockSetChatMode).toHaveBeenCalledWith("agent");
    expect(mockSetSandboxPreference).not.toHaveBeenCalled();
  });
});
