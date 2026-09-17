import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { toast } from "sonner";
import { takeNewChatMessage } from "@/lib/utils/new-chat-message";
import * as tokenUtils from "@/lib/client-token-estimate";

import {
  normalizeAgentRosterConfiguration,
  parseAgentRosterConfiguration,
  renderAgentRosterSkillInstructions,
} from "@/lib/ai/agents/pet-roster";
import { AgentsWorkbench } from "../AgentsWorkbench";

jest.mock("@/lib/client-token-estimate", () => {
  const actual = jest.requireActual("@/lib/client-token-estimate");
  return { ...actual, countInputTokens: jest.fn(actual.countInputTokens) };
});

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));

const routerPush = jest.fn();
const routerReplace = jest.fn();
const initializeNewChat = jest.fn();
const setInput = jest.fn();
const syncRoster = jest.fn(async () => ({
  success: true,
  id: "managed-roster",
}));
const searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat,
    subscription: "pro",
    hasPaidContext: true,
  }),
}));

jest.mock("@/app/contexts/InputContext", () => ({
  useInputApi: () => ({ setInput }),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const configuredRoster = normalizeAgentRosterConfiguration({
  activeAgentId: "build-engineer",
  workflowAgentIds: ["build-engineer", "quality"],
  customAgents: [
    {
      name: "Sentinel",
      petId: "german-shepherd",
      roleName: "Security Engineer",
      mission: "Review scoped changes for concrete security risk.",
      skillIds: [
        "recon-methodology",
        "web-vuln-hunting",
        "pentest-report",
        "ctf-playbook",
      ],
    },
  ],
});

function mockSkills(withRoster = true) {
  jest.mocked(useQuery).mockImplementation((query) => {
    const name = getFunctionName(query as never);
    if (name !== "skills:listForUser") return undefined;
    return (
      withRoster
        ? [
            {
              _id: "managed-roster",
              catalog_id: "rift-agent-roster",
              description: "Managed agent roster",
              enabled: true,
              instructions:
                renderAgentRosterSkillInstructions(configuredRoster),
              name: "RIFT Agent Crew",
            },
            {
              _id: "skill-1",
              catalog_id: "sql-data",
              description: "Work with structured data.",
              enabled: true,
              instructions: "Use verifiable data operations.",
              name: "SQL Data",
            },
          ]
        : []
    ) as never;
  });
}

describe("AgentsWorkbench", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    jest.mocked(useMutation).mockReturnValue(syncRoster as never);
    mockSkills();
  });

  it("renders the real configured roster and invokes its exact Build mention", async () => {
    render(<AgentsWorkbench />);

    expect(
      await screen.findByRole("heading", { name: "Agents" }),
    ).toBeVisible();
    // The page opens on the catalog: an empty list of "active participants"
    // shows nothing and offers nothing on a first visit.
    fireEvent.click(screen.getByRole("tab", { name: /Roster/ }));
    expect(screen.getByText("Sentinel")).toBeVisible();
    expect(screen.getByText("@agent:sentinel")).toBeVisible();
    expect(screen.getByText(/No attributed runtime history/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Invoke in Build" }));

    expect(initializeNewChat).toHaveBeenCalledWith("app");
    expect(routerPush).toHaveBeenCalledWith("/");
    await waitFor(() =>
      expect(setInput).toHaveBeenCalledWith("@agent:sentinel "),
    );
  });

  it("shows all 29 professional templates without implying they are running", async () => {
    render(<AgentsWorkbench />);
    await screen.findByRole("heading", { name: "Agents" });

    // Already the default view; clicking it is still the honest way to say so.
    fireEvent.click(screen.getByRole("tab", { name: /Catalog/ }));
    const catalog = screen
      .getByRole("heading", { name: "Professional pet catalog" })
      .closest("section");
    expect(catalog).not.toBeNull();
    expect(
      within(catalog as HTMLElement).getAllByRole("button", {
        name: /template/i,
      }),
    ).toHaveLength(29);
  });

  it("creates a normalized agent and persists the executable runtime pack", async () => {
    mockSkills(false);
    render(<AgentsWorkbench />);
    await screen.findByRole("heading", { name: "Agents" });

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    // Creation is now a guided five-step flow: the commit lives on the final
    // Review & test step, after the effective permissions have been shown.
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Create agent/ }));

    await waitFor(() => expect(syncRoster).toHaveBeenCalledTimes(1));
    const payload = syncRoster.mock.calls[0][0];
    const persisted = parseAgentRosterConfiguration(payload.instructions);
    expect(persisted?.customAgents).toHaveLength(1);
    expect(persisted?.customAgents[0]).toMatchObject({
      mention: "@agent:buddy",
      roleName: "Generalist Engineer",
      toolIds: expect.arrayContaining([
        "find_skills",
        "verify_app",
        "expose_preview",
      ]),
      skillIds: expect.arrayContaining([
        "react-best-practices",
        "ui-ux-pro-max",
      ]),
    });
  });

  it("keeps the editor open and never launches a test when saving fails", async () => {
    syncRoster.mockRejectedValueOnce(new Error("Roster save unavailable"));
    render(<AgentsWorkbench />);
    await screen.findByRole("heading", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.change(screen.getByLabelText(/Test prompt/), {
      target: { value: "Review this agent's available tools" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Roster save unavailable"),
    );
    expect(routerPush).not.toHaveBeenCalled();
    expect(initializeNewChat).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("opens a fresh Build with a destination-owned test intent after saving", async () => {
    render(<AgentsWorkbench />);
    await screen.findByRole("heading", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.change(screen.getByLabelText(/Test prompt/), {
      target: { value: "List the tools available to this agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalled());
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringMatching(/^\/\?agentTest=/),
    );
    expect(initializeNewChat).toHaveBeenCalledWith("app");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const intentId = new URL(
      routerPush.mock.calls[0][0],
      "http://localhost",
    ).searchParams.get("agentTest");
    expect(takeNewChatMessage(intentId!)).toBe(
      "@agent:buddy List the tools available to this agent",
    );
  });

  it("retains an oversized test prompt in the editor without saving or navigating", async () => {
    const testPrompt = "Keep this oversized draft in the editor";
    jest.mocked(tokenUtils.countInputTokens).mockReturnValueOnce(1_100_000);
    render(<AgentsWorkbench />);
    await screen.findByRole("heading", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.change(screen.getByLabelText(/Test prompt/), {
      target: { value: testPrompt },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Test prompt is too long",
        expect.any(Object),
      ),
    );
    expect(syncRoster).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(initializeNewChat).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Test prompt/)).toHaveValue(testPrompt);
  });
});
