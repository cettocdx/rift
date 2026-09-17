import { render, screen } from "@testing-library/react";
import {
  getWorkspaceModeLabel,
  ProTitlebarModelMenu,
} from "../ProTitlebarModelMenu";

const mockSetChatMode = jest.fn();
const mockSetSelectedModel = jest.fn();
let mockSelectedModel = "auto";
let mockChatMode = "agent";

jest.mock("@/app/hooks/useHydrated", () => ({
  useHydrated: () => true,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatMode: mockChatMode,
    setChatMode: mockSetChatMode,
    selectedModel: mockSelectedModel,
    setSelectedModel: mockSetSelectedModel,
    chatPurpose: "app",
  }),
}));

describe("ProTitlebarModelMenu", () => {
  beforeEach(() => {
    mockSelectedModel = "auto";
    mockChatMode = "agent";
  });

  it("describes the same effective default as the Build composer", () => {
    render(<ProTitlebarModelMenu />);

    expect(
      screen.getByRole("button", {
        name: "Mode and model: Agent / GPT-5.6 Sol",
      }),
    ).toBeVisible();
  });

  it("describes an explicit family selection by its public model name", () => {
    mockSelectedModel = "build-grok";
    render(<ProTitlebarModelMenu />);

    expect(
      screen.getByRole("button", {
        name: "Mode and model: Agent / Grok 4.6",
      }),
    ).toBeVisible();
  });

  it("uses the same Plan label as the Build composer for ask mode", () => {
    mockChatMode = "ask";
    render(<ProTitlebarModelMenu />);

    expect(
      screen.getByRole("button", {
        name: "Mode and model: Plan / GPT-5.6 Sol",
      }),
    ).toBeVisible();
    expect(getWorkspaceModeLabel("ask")).toBe("Plan");
  });
});
