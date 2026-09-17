import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AgentAssignableSkill } from "@/app/components/agents/AgentProfileDialog";
import {
  AGENT_PET_ROSTER,
  AGENT_ROSTER_LIMITS,
  DEFAULT_AGENT_ROSTER_SELECTION,
  normalizeAgentRosterConfiguration,
  type AgentTeamConfig,
} from "@/lib/ai/agents/pet-roster";
import { AgentTeamDialog } from "../AgentTeamDialog";

const installedSkills: AgentAssignableSkill[] = Array.from(
  { length: 9 },
  (_, index) => ({
    id: `installed-skill-${index + 1}`,
    name: `Installed skill ${index + 1}`,
    description: `Capability ${index + 1}`,
    enabled: true,
    source: "installed",
  }),
);

function buildConfiguration() {
  return normalizeAgentRosterConfiguration({
    ...DEFAULT_AGENT_ROSTER_SELECTION,
    activeAgentId: "build-engineer",
    workflowAgentIds: ["build-engineer", "quality"],
    customAgents: [
      {
        id: "atlas",
        mention: "@agent:atlas",
        name: "Atlas",
        petId: "wolf",
        roleName: "Systems Architect",
        mission: "Own architecture and integration decisions.",
        skillIds: [
          "react-best-practices",
          "sql-data",
          "concise-expert",
          "web-vuln-hunting",
        ],
      },
      {
        id: "disabled",
        mention: "@agent:disabled",
        enabled: false,
        name: "Disabled",
        petId: "dog",
      },
    ],
  });
}

describe("AgentTeamDialog", () => {
  it("saves a normalized executable team contract", async () => {
    const onSave = jest.fn<Promise<void>, [AgentTeamConfig]>();
    onSave.mockResolvedValue(undefined);

    render(
      <AgentTeamDialog
        configuration={buildConfiguration()}
        installedSkills={installedSkills}
        onClose={jest.fn()}
        onSave={onSave}
        open
        saving={false}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: "Include Disabled in team" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Platform migration" },
    });
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Migrate the platform with verified handoffs." },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Probe in team" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Atlas in team" }),
    );
    fireEvent.change(screen.getByLabelText("Team lead"), {
      target: { value: "agent-atlas" },
    });
    fireEvent.change(screen.getByLabelText("Final reviewer"), {
      target: { value: "quality" },
    });
    fireEvent.change(screen.getByLabelText("Routing"), {
      target: { value: "parallel" },
    });
    fireEvent.change(screen.getByLabelText("Handoff"), {
      target: { value: "explicit" },
    });
    fireEvent.change(screen.getByLabelText("Escalation"), {
      target: { value: "when-blocked" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Share Installed skill 1 with team",
      }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Completion criteria" }),
      {
        target: {
          value:
            "Migration tests pass.\nThe final reviewer verifies the running path.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: "team-platform-migration",
        mention: "@team:platform-migration",
        name: "Platform migration",
        goal: "Migrate the platform with verified handoffs.",
        memberAgentIds: ["build-engineer", "quality", "agent-atlas"],
        leadAgentId: "agent-atlas",
        finalReviewerAgentId: "quality",
        routing: "parallel",
        handoff: "explicit",
        escalationPolicy: "when-blocked",
        sharedSkillIds: ["installed-skill-1"],
        completionCriteria: [
          "Migration tests pass.",
          "The final reviewer verifies the running path.",
        ],
      }),
    );
  });

  it("enforces member, skill, and completion-line limits in the editor", () => {
    const configuration = normalizeAgentRosterConfiguration({
      ...DEFAULT_AGENT_ROSTER_SELECTION,
      workflowAgentIds: AGENT_PET_ROSTER.map((agent) => agent.id),
      customAgents: Array.from(
        { length: AGENT_ROSTER_LIMITS.customAgents },
        (_, index) => ({
          id: `custom-${index + 1}`,
          mention: `@agent:custom-${index + 1}`,
          name: `Custom ${index + 1}`,
          petId: "dog",
        }),
      ),
    });

    render(
      <AgentTeamDialog
        configuration={configuration}
        installedSkills={installedSkills}
        onClose={jest.fn()}
        onSave={jest.fn()}
        open
        saving={false}
      />,
    );

    for (const name of [
      "Pixel",
      "Scout",
      "Echo",
      "Probe",
      "Frame",
      "Custom 1",
      "Custom 2",
    ]) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Include ${name} in team` }),
      );
    }
    expect(
      screen.getByRole("checkbox", { name: "Include Custom 3 in team" }),
    ).toBeDisabled();

    for (
      let index = 1;
      index <= AGENT_ROSTER_LIMITS.sharedSkillsPerTeam;
      index += 1
    ) {
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: `Share Installed skill ${index} with team`,
        }),
      );
    }
    expect(
      screen.getByRole("checkbox", {
        name: "Share Installed skill 9 with team",
      }),
    ).toBeDisabled();

    const criteria = screen.getByRole("textbox", {
      name: "Completion criteria",
    });
    fireEvent.change(criteria, {
      target: {
        value: Array.from(
          { length: 9 },
          (_, index) => `Check ${index + 1}`,
        ).join("\n"),
      },
    });
    expect((criteria as HTMLTextAreaElement).value.split("\n")).toHaveLength(
      AGENT_ROSTER_LIMITS.completionCriteriaPerTeam,
    );
  });
});
