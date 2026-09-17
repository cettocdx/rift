import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SidebarGithub } from "../SidebarGithub";
let mockStatus: { connected: boolean; username?: string } = {
  connected: true,
  username: "octo",
};
let mockProjects: Array<{
  _id: string;
  name: string;
  type: string;
  github_repository?: typeof repo;
}> = [];
const mockInitialize = jest.fn();
const mockGo = jest.fn();
const mockSetProject = jest.fn();
const mockCloseSidebar = jest.fn();
const mockChatSidebar = jest.fn();
const mockTemporary = jest.fn();
jest.mock("convex/react", () => ({
  useQuery: (query: unknown) =>
    require("convex/server").getFunctionName(query) === "github:getStatus"
      ? mockStatus
      : mockProjects,
}));
jest.mock("../GithubConnectButton", () => ({
  GithubConnectButton: () => <button>Connect GitHub</button>,
  GithubMark: () => <svg />,
}));
jest.mock("../SidebarHeader", () => ({
  SIDEBAR_SECTION_LABEL_CLASS: "",
  sidebarNavRowClass: () => "repo-row",
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goPurpose: mockGo }),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat: mockInitialize,
    closeSidebar: mockCloseSidebar,
    setChatSidebarOpen: mockChatSidebar,
    setTemporaryChatsEnabled: mockTemporary,
    setActiveProject: mockSetProject,
  }),
}));
const repo = {
  id: 1,
  fullName: "octo/project",
  defaultBranch: "main",
  private: true,
};
const project = { id: "p1", name: "octo/project", type: "app" };
const json = (value: unknown, ok = true) =>
  Promise.resolve({ ok, json: async () => value });
const openPicker = () =>
  fireEvent.click(screen.getByRole("button", { name: "Add repositories" }));
function mockSuccess() {
  (fetch as jest.Mock).mockImplementation((url: string) =>
    url.endsWith("/open")
      ? json({ project })
      : json({ repositories: [repo], hasMore: false }),
  );
}
describe("GitHub repository picker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { connected: true, username: "octo" };
    mockProjects = [];
    global.fetch = jest.fn() as any;
  });
  afterEach(() => jest.useRealTimers());
  it("ends a stalled list request and lets the user retry", async () => {
    jest.useFakeTimers();
    (fetch as jest.Mock).mockImplementationOnce(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Aborted"))),
        ),
    );
    render(<SidebarGithub />);
    openPicker();
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(screen.getByRole("alert")).toHaveTextContent("timed out");
    expect(screen.queryByText("Loading repositories…")).not.toBeInTheDocument();
    mockSuccess();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", {
        name: "Add repository octo/project",
      }),
    ).toBeVisible();
  });
  it("releases a stalled addition without starting a chat and permits retry", async () => {
    jest.useFakeTimers();
    (fetch as jest.Mock)
      .mockImplementationOnce(() =>
        json({ repositories: [repo], hasMore: false }),
      )
      .mockImplementationOnce(
        (_url: string, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("Aborted")),
            ),
          ),
      );
    render(<SidebarGithub />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add repository octo/project",
      }),
    );
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(screen.getByRole("alert")).toHaveTextContent("timed out");
    expect(mockInitialize).not.toHaveBeenCalled();
    mockSuccess();
    fireEvent.click(
      screen.getByRole("button", { name: "Add repository octo/project" }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Open repository octo/project",
      }),
    ).toBeEnabled();
  });
  it("only lists available repositories after the user opens the picker", async () => {
    mockSuccess();
    render(<SidebarGithub />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    openPicker();
    const dialog = screen.getByRole("dialog", {
      name: "Add GitHub repositories",
    });
    expect(
      await within(dialog).findByRole("button", {
        name: "Add repository octo/project",
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("textbox", {
        name: "Filter loaded GitHub repositories",
      }),
    ).toHaveFocus();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: " missing " },
    });
    expect(
      within(dialog).getByText("No matches in loaded repositories."),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: " OCTO " },
    });
    expect(
      within(dialog).getByRole("button", {
        name: "Add repository octo/project",
      }),
    ).toBeVisible();
    expect(mockInitialize).not.toHaveBeenCalled();
  });
  it("adds a repository without starting work and can then open its project", async () => {
    mockSuccess();
    render(<SidebarGithub />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add repository octo/project",
      }),
    );
    const open = await screen.findByRole("button", {
      name: "Open repository octo/project",
    });
    expect(screen.getByText("Added")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/github/repositories/open",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ fullName: repo.fullName }),
      }),
    );
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockGo).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() =>
      expect(mockInitialize).toHaveBeenCalledWith("app", project),
    );
    expect(mockGo).toHaveBeenCalledWith("app");
    expect(mockCloseSidebar).toHaveBeenCalled();
    expect(mockChatSidebar).toHaveBeenCalledWith(false);
    expect(mockTemporary).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("recognizes a renamed existing project by repository ID and reopens its conversation", async () => {
    mockProjects = [
      { _id: "p1", name: "My workspace", type: "app", github_repository: repo },
    ];
    (fetch as jest.Mock).mockImplementation((url: string) =>
      url.endsWith("/open")
        ? json({ project: { ...project, name: "My workspace" } })
        : json({ repositories: [repo], hasMore: false }),
    );
    render(<SidebarGithub chats={[{ id: "c1", project_id: "p1" } as any]} />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open repository octo/project",
      }),
    );
    await waitFor(() => expect(mockGo).toHaveBeenCalledWith("app", "c1"));
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockSetProject).toHaveBeenCalledWith({
      ...project,
      name: "My workspace",
    });
  });
  it("updates an added marker after the persisted project is removed", async () => {
    mockSuccess();
    const { rerender } = render(<SidebarGithub />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add repository octo/project",
      }),
    );
    await screen.findByText("Added");
    mockProjects = [
      { _id: "p1", name: repo.fullName, type: "app", github_repository: repo },
    ];
    rerender(<SidebarGithub />);
    mockProjects = [];
    rerender(<SidebarGithub />);
    expect(
      screen.getByRole("button", { name: "Add repository octo/project" }),
    ).toBeVisible();
  });
  it("discards late listing responses after disconnecting", async () => {
    let resolve!: (value: unknown) => void;
    (fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { rerender } = render(<SidebarGithub />);
    openPicker();
    mockStatus = { connected: false };
    rerender(<SidebarGithub />);
    await act(async () =>
      resolve(await json({ repositories: [repo], hasMore: false })),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add repositories" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect GitHub" }),
    ).toBeVisible();
  });
  it("discards a late open response after closing the picker", async () => {
    mockProjects = [
      { _id: "p1", name: repo.fullName, type: "app", github_repository: repo },
    ];
    let resolve!: (value: unknown) => void;
    (fetch as jest.Mock).mockImplementation((url: string) =>
      url.endsWith("/open")
        ? new Promise((r) => {
            resolve = r;
          })
        : json({ repositories: [repo], hasMore: false }),
    );
    render(<SidebarGithub />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open repository octo/project",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await act(async () => resolve(await json({ project })));
    expect(mockGo).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
  });
  it("shows listing failures and retries the requested page without losing loaded rows", async () => {
    (fetch as jest.Mock)
      .mockImplementationOnce(() =>
        json({ repositories: [repo], hasMore: true }),
      )
      .mockImplementationOnce(() =>
        json({ error: "GitHub is unavailable" }, false),
      )
      .mockImplementationOnce(() =>
        json({
          repositories: [repo, { ...repo, id: 2, fullName: "octo/second" }],
          hasMore: false,
        }),
      );
    render(<SidebarGithub />);
    openPicker();
    await screen.findByRole("button", { name: "Add repository octo/project" });
    fireEvent.click(
      screen.getByRole("button", { name: "Load more repositories" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Add repository octo/project" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Add repository octo/second" });
    expect(
      screen.getAllByRole("button", { name: /^Add repository / }),
    ).toHaveLength(2);
    expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      "/api/github/repositories?page=1",
      "/api/github/repositories?page=2",
      "/api/github/repositories?page=2",
    ]);
  });
  it("keeps a failed addition available to retry", async () => {
    (fetch as jest.Mock)
      .mockImplementationOnce(() =>
        json({ repositories: [repo], hasMore: false }),
      )
      .mockImplementationOnce(() =>
        json({ error: "Project limit reached" }, false),
      )
      .mockImplementationOnce(() => json({ project }));
    render(<SidebarGithub />);
    openPicker();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add repository octo/project",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Project limit reached",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add repository octo/project" }),
    );
    await screen.findByText("Added");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows an empty connection clearly", async () => {
    (fetch as jest.Mock).mockImplementation(() =>
      json({ repositories: [], hasMore: false }),
    );
    render(<SidebarGithub />);
    openPicker();
    expect(
      await screen.findByText("No repositories available to this connection."),
    ).toBeVisible();
  });
});
