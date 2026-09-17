import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { ProjectBotsWorkbench } from "../ProjectBotsWorkbench";
import {
  createProjectBotProfile,
  PROJECT_BOT_TEMPLATES,
} from "@/lib/ai/agents/project-bot-templates";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));
const push = jest.fn();
const replace = jest.fn();
let searchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));
jest.mock("next/dynamic", () => () => () => null);
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const create = jest.fn();
const update = jest.fn();
const archive = jest.fn();
const openChat = jest.fn();
const createProject = jest.fn();
const createTask = jest.fn();
const createMeeting = jest.fn();
const openMeeting = jest.fn();
let meetings: unknown;
let skills: unknown = [];
let projects: unknown;
let bots: unknown;
const project = { _id: "project-1", name: "Rift", type: "app" };
const template = PROJECT_BOT_TEMPLATES[0];
function bot(id = "bot-1") {
  return {
    _id: id,
    project_id: project._id,
    chat_id: `chat-${id}`,
    name: template.name,
    mission: template.mission,
    template_id: template.id,
    profile_json: JSON.stringify(
      createProjectBotProfile(template.id, template.name),
    ),
    created_at: 1,
    updated_at: 1,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  projects = [project];
  bots = [];
  meetings = [];
  skills = [];
  createMeeting.mockResolvedValue({
    meetingId: "meeting-1",
    chatId: "meeting-chat",
  });
  openMeeting.mockResolvedValue("saved-meeting-chat");
  create.mockResolvedValue({ botId: "bot-new", chatId: "saved-chat" });
  openChat.mockResolvedValue("persisted-chat");
  archive.mockResolvedValue(null);
  createTask.mockResolvedValue({ success: true, id: "task-1" });
  createProject.mockResolvedValue({ success: true, id: "project-new" });
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: jest.fn(() => "request-unique"),
  });
  jest.mocked(useQuery).mockImplementation((query, args) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(query as never);
    if (name === "projects:listForUser") return projects as never;
    if (name === "projectBots:list") return bots as never;
    if (name === "botMeetings:list") return meetings as never;
    if (name === "skills:listForUser") return skills as never;
    return [] as never;
  });
  jest.mocked(useMutation).mockImplementation((mutation) => {
    const name = getFunctionName(mutation as never);
    return ({
      "tasks:createTask": createTask,
      "botMeetings:create": createMeeting,
      "botMeetings:openChat": openMeeting,
      "projectBots:create": create,
      "projectBots:update": update,
      "projectBots:archive": archive,
      "projectBots:openChat": openChat,
      "projects:createProject": createProject,
    }[name] ?? jest.fn()) as never;
  });
});

test("empty project adds a chosen bot once and does not start a chat run", async () => {
  let resolve!: (value: unknown) => void;
  create.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<ProjectBotsWorkbench />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose your first bot" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Bot name"), {
    target: { value: "My lead" },
  });
  const add = within(dialog).getByRole("button", { name: "Add to project" });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    projectId: "project-1",
    templateId: template.id,
    name: "My lead",
    requestId: "request-unique",
  });
  expect(push).not.toHaveBeenCalled();
  resolve({ botId: "bot-new", chatId: "saved-chat" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(openChat).not.toHaveBeenCalled();
});

test("opens the server-resolved saved chat instead of creating a new prompt", async () => {
  bots = [bot()];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: /Open conversation/ }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/c/persisted-chat"));
  expect(openChat).toHaveBeenCalledWith({ id: "bot-1" });
  expect(create).not.toHaveBeenCalled();
});

test("failed create retains inputs and uses the same idempotency key for retry", async () => {
  create.mockRejectedValueOnce(new Error("Connection unavailable"));
  render(<ProjectBotsWorkbench />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose your first bot" }),
  );
  fireEvent.change(screen.getByLabelText("Bot name"), {
    target: { value: "Retained name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to project" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("Connection unavailable"),
  );
  expect(screen.getByLabelText("Bot name")).toHaveValue("Retained name");
  fireEvent.click(screen.getByRole("button", { name: "Add to project" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0].requestId).toBe(
    create.mock.calls[0][0].requestId,
  );
});

test("project query chooses its own bot list; switching stays on bot route", () => {
  projects = [project, { _id: "project-2", name: "Studio", type: "app" }];
  searchParams = new URLSearchParams("project=project-2");
  render(<ProjectBotsWorkbench />);
  expect(screen.getByLabelText("Project")).toHaveValue("project-2");
  expect(
    jest
      .mocked(useQuery)
      .mock.calls.some(
        ([query, args]) =>
          getFunctionName(query as never) === "projectBots:list" &&
          (args as { projectId?: string })?.projectId === "project-2",
      ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Project"), {
    target: { value: "project-1" },
  });
  expect(replace).toHaveBeenCalledWith("/agents?project=project-1", {
    scroll: false,
  });
});

test("archive requires an inline confirmation and preserves chat history copy", async () => {
  bots = [bot()];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "Archive bot" }));
  expect(archive).not.toHaveBeenCalled();
  expect(screen.getByText(/Chat history is kept/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(archive).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Archive bot" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive bot" }));
  await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: "bot-1" }));
});

test("shows a project creation flow when no projects exist", async () => {
  projects = [];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getAllByRole("button", { name: "Create project" })[1]);
  fireEvent.change(screen.getByLabelText("Project name"), {
    target: { value: "New team" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create project",
    }),
  );
  await waitFor(() =>
    expect(createProject).toHaveBeenCalledWith({
      name: "New team",
      type: "app",
    }),
  );
  expect(replace).toHaveBeenCalledWith("/agents?project=project-new", {
    scroll: false,
  });
});

test("does not show an empty state before subscriptions resolve", () => {
  projects = undefined;
  render(<ProjectBotsWorkbench />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your team");
  expect(screen.queryByText("Start with a project")).not.toBeInTheDocument();
});

test("meeting creation uses only explicitly selected participants and opens its saved room", async () => {
  bots = [
    bot("a"),
    { ...bot("b"), name: "Reviewer" },
    { ...bot("c"), name: "Designer" },
  ];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Meeting title"), {
    target: { value: "UI review" },
  });
  fireEvent.change(within(dialog).getByLabelText("Agenda"), {
    target: { value: "Review the new navigation" },
  });
  expect(
    within(dialog).getByRole("checkbox", { name: "Designer" }),
  ).not.toBeChecked();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create meeting" }),
  );
  await waitFor(() =>
    expect(createMeeting).toHaveBeenCalledWith({
      projectId: "project-1",
      title: "UI review",
      agenda: "Review the new navigation",
      participantBotIds: ["a", "b"],
      requestId: "request-unique",
    }),
  );
  expect(push).toHaveBeenCalledWith("/c/meeting-chat");
});

test("meetings with fewer than two selected bots cannot be created", () => {
  bots = [bot("a"), { ...bot("b"), name: "Reviewer" }];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
  fireEvent.change(screen.getByLabelText("Meeting title"), {
    target: { value: "Review" },
  });
  fireEvent.change(screen.getByLabelText("Agenda"), {
    target: { value: "Review now" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Reviewer" }));
  expect(screen.getByRole("button", { name: "Create meeting" })).toBeDisabled();
});

test("existing meeting opens the same backend-authorized conversation", async () => {
  bots = [bot()];
  meetings = [
    {
      _id: "meeting-1",
      title: "Design review",
      agenda: "Navigation",
      participant_bot_ids: ["a", "b"],
    },
  ];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: /Design review/ }));
  await waitFor(() =>
    expect(openMeeting).toHaveBeenCalledWith({ id: "meeting-1" }),
  );
  expect(push).toHaveBeenCalledWith("/c/saved-meeting-chat");
});

test("assigns a manual task to the selected project bot without running it", async () => {
  bots = [bot()];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Review changes" },
  });
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Inspect the diff and report findings" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Assign task" }));
  await waitFor(() =>
    expect(createTask).toHaveBeenCalledWith({
      projectId: "project-1",
      assigneeBotId: "bot-1",
      title: "Review changes",
      prompt: "Inspect the diff and report findings",
      purpose: "app",
      scheduleType: "manual",
    }),
  );
  expect(openChat).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("a future meeting passes the user's local timezone to durable scheduling", async () => {
  bots = [bot("a"), { ...bot("b"), name: "Reviewer" }];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
  fireEvent.change(screen.getByLabelText("Meeting title"), {
    target: { value: "Weekly review" },
  });
  fireEvent.change(screen.getByLabelText("Agenda"), {
    target: { value: "Inspect project progress" },
  });
  fireEvent.change(screen.getByLabelText(/Schedule for later/), {
    target: { value: "2099-01-01T12:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create meeting" }));
  await waitFor(() =>
    expect(createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledFor: new Date("2099-01-01T12:00").getTime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    ),
  );
});

test("meeting lead can be chosen explicitly and is always sent first", async () => {
  bots = [
    bot("a"),
    { ...bot("b"), name: "Reviewer" },
    { ...bot("c"), name: "Coordinator" },
  ];
  render(<ProjectBotsWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
  fireEvent.change(screen.getByLabelText("Meeting title"), {
    target: { value: "Review" },
  });
  fireEvent.change(screen.getByLabelText("Agenda"), {
    target: { value: "Review progress" },
  });
  fireEvent.change(screen.getByLabelText(/Meeting lead/), {
    target: { value: "c" },
  });
  expect(screen.getByRole("checkbox", { name: "Coordinator" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Coordinator" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Create meeting" }));
  await waitFor(() =>
    expect(createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ participantBotIds: ["c", "a", "b"] }),
    ),
  );
});

test("bots without runtime delegation cannot lead meetings", () => {
  const blocked = bot();
  const profile = JSON.parse(blocked.profile_json);
  profile.toolIds = ["file"];
  blocked.profile_json = JSON.stringify(profile);
  bots = [blocked, { ...blocked, _id: "b", name: "Research" }];
  render(<ProjectBotsWorkbench />);
  expect(screen.getByRole("button", { name: "New meeting" })).toBeDisabled();
  expect(
    screen.getByText(/Enable delegation for a project bot/),
  ).toBeInTheDocument();
});

test("uses saved skill names in the project bot profile", () => {
  const custom = bot();
  const profile = JSON.parse(custom.profile_json);
  profile.skillIds = ["private-qa-pack"];
  custom.profile_json = JSON.stringify(profile);
  skills = [
    {
      _id: "private-qa-pack",
      name: "Product quality review",
      description: "Our QA checks",
      enabled: true,
    },
  ];
  bots = [custom];
  render(<ProjectBotsWorkbench />);
  expect(screen.getByText("Product quality review")).toBeInTheDocument();
  expect(screen.queryByText("private qa pack")).not.toBeInTheDocument();
  expect(screen.queryByRole("main")).not.toBeInTheDocument();
});
