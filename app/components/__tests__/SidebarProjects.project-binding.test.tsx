import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarProjects } from "../SidebarProjects";
import { ProShellProvider } from "../pro/ProShellContext";

const initializeNewChat = jest.fn();
const closeSidebar = jest.fn();
const setChatSidebarOpen = jest.fn();
const setTemporaryChatsEnabled = jest.fn();
const goPurpose = jest.fn();
const setActiveProject = jest.fn();
const routerPush = jest.fn();
let mockProjects: Array<{
  _id: string;
  name: string;
  type: "security" | "app" | "image";
  created_at: number;
  updated_at: number;
}> = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

jest.mock("convex/react", () => ({
  useQuery: () => mockProjects,
  useMutation: () => jest.fn(),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat,
    closeSidebar,
    setChatSidebarOpen,
    setTemporaryChatsEnabled,
    setActiveProject,
  }),
}));

jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goPurpose }),
}));

jest.mock("../SidebarConversation", () => ({
  SidebarConversation: ({ chat }: { chat: { title: string } }) => (
    <span>{chat.title}</span>
  ),
}));

describe("SidebarProjects project binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProjects = [
      {
        _id: "project-alpha",
        name: "Alpha build",
        type: "app",
        created_at: 1,
        updated_at: 1,
      },
    ];
  });

  it("starts a new chat with the selected project id and type", () => {
    render(<SidebarProjects />);

    fireEvent.click(screen.getByRole("button", { name: "Alpha build", exact: true }));

    expect(initializeNewChat).toHaveBeenCalledWith("app", {
      id: "project-alpha",
      type: "app",
      name: "Alpha build",
    });
    expect(closeSidebar).toHaveBeenCalled();
    expect(setTemporaryChatsEnabled).toHaveBeenCalledWith(false);
    expect(goPurpose).toHaveBeenCalledWith("app");
    expect(setChatSidebarOpen).not.toHaveBeenCalled();
  });

  it("opens the latest project conversation without resetting it", () => {
    const chats = [
      {
        id: "project-chat",
        _id: "db-chat",
        title: "Existing build",
        project_id: "project-alpha",
      },
    ];
    render(<SidebarProjects chats={chats as never} />);
    expect(
      screen.getByLabelText("Alpha build conversations"),
    ).toHaveTextContent("Existing build");
    fireEvent.click(screen.getByRole("button", { name: "Alpha build", exact: true }));
    expect(goPurpose).toHaveBeenCalledWith("app", "project-chat");
    expect(setActiveProject).toHaveBeenCalledWith({
      id: "project-alpha",
      name: "Alpha build",
      type: "app",
    });
    expect(initializeNewChat).not.toHaveBeenCalled();
  });

  it("routes a legacy Security project into Hack Workbench", () => {
    mockProjects = [
      {
        _id: "legacy-security",
        name: "Legacy assessment",
        type: "security",
        created_at: 1,
        updated_at: 1,
      },
    ];
    render(<SidebarProjects />);

    fireEvent.click(screen.getByRole("button", { name: /Legacy assessment/i }));

    expect(routerPush).toHaveBeenCalledWith("/hack");
    expect(initializeNewChat).not.toHaveBeenCalled();
    expect(setTemporaryChatsEnabled).toHaveBeenCalledWith(false);
  });

  it("offers only Build and Image when creating a new project", () => {
    mockProjects = [];
    render(<SidebarProjects />);

    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[0]);

    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /security|hack workbench/i }),
    ).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before removing a project", () => {
    render(<SidebarProjects />);

    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));

    expect(
      screen.getByRole("alertdialog", { name: "Remove Alpha build?" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Existing conversations stay in history/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("alertdialog", { name: "Remove Alpha build?" }),
    ).not.toBeInTheDocument();
  });
});
