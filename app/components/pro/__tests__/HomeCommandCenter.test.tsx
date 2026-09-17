import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";

import { getFunctionName } from "convex/server";
import { HomeCommandCenter } from "../HomeCommandCenter";
import { requestProjectSelector } from "@/lib/utils/composer-controls";

const setActiveProject = jest.fn();
const setSandboxPreference = jest.fn();
let mockChat: unknown = null;
const mockAttachClick = jest.fn().mockResolvedValue(null);
jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: () => true }));
jest.mock("@/app/services/desktop-local-access", () => ({
  requestDesktopFileAccess: () => mockAttachClick(),
  listDesktopWorkspaceGrants: jest.fn().mockResolvedValue([]),
}));
jest.mock("convex/react", () => ({
  useQuery: (query: never) =>
    getFunctionName(query) === "chats:getChatByIdFromClient"
      ? mockChat
      : [
          { _id: "project-1", name: "Launch app", type: "app" },
          { _id: "project-2", name: "Second build", type: "app" },
        ],
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    activeProject: { id: "project-1", name: "Launch app", type: "app" },
    setActiveProject,
    sandboxPreference: "e2b",
    setSandboxPreference,
    hasLocalSandbox: true,
    defaultLocalSandboxPreference: "local",
  }),
}));

describe("New agent workspace context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChat = null;
    window.sessionStorage.clear();
  });

  it("opens a project request carried from the /project command", async () => {
    expect(requestProjectSelector()).toBe(false);
    render(<HomeCommandCenter chatId="chat-a" />);

    expect(await screen.findByText("Project context")).toBeVisible();
    expect(screen.getByText("No project")).toBeVisible();
  });

  it("shows project and the selected execution target", () => {
    render(<HomeCommandCenter chatId="chat-a" />);

    expect(screen.queryByText("Open file")).not.toBeInTheDocument();
    expect(screen.getByText("Launch app")).toBeVisible();

    expect(
      screen.getByRole("button", { name: "Select project context" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Execution target: Cloud" }),
    ).toBeEnabled();
  });

  it("updates the existing execution preference from the context menu", () => {
    render(<HomeCommandCenter chatId="chat-a" />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Execution target: Cloud" }),
      { key: "Enter" },
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Local", exact: true }),
    );
    expect(setSandboxPreference).toHaveBeenCalledWith("local");
  });

  it("removes the planning shortcut from the new-agent surface", () => {
    const commandCenterSource = fs.readFileSync(
      path.join(process.cwd(), "app/components/pro/HomeCommandCenter.tsx"),
      "utf8",
    );
    const chatSource = fs.readFileSync(
      path.join(process.cwd(), "app/components/chat.tsx"),
      "utf8",
    );

    expect(commandCenterSource).not.toMatch(
      /Plan New Idea|Plan a new build idea/,
    );
    expect(chatSource).not.toContain("HomeQuickActions");
  });
});

it("shows and locks the server-bound project for a fresh bot chat", () => {
  mockChat = {
    id: "fresh-bot",
    project_id: "project-2",
    project_bot_id: "bot-1",
  };
  render(<HomeCommandCenter chatId="fresh-bot" />);
  expect(
    screen.getByRole("button", { name: "Project: Second build" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Select project context" }),
  ).not.toBeInTheDocument();
  expect(setActiveProject).toHaveBeenCalledWith({
    id: "project-2",
    name: "Second build",
    type: "app",
  });
});
