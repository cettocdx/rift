"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ShieldCheck, UsersRound } from "lucide-react";

import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import type { AgentAssignableSkill } from "@/app/components/agents/AgentProfileDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_PET_ROSTER,
  AGENT_ROSTER_LIMITS,
  getAgentPetCatalogDefinition,
  normalizeAgentRosterConfiguration,
  type AgentEscalationPolicy,
  type AgentPetRoleId,
  type AgentRosterConfiguration,
  type AgentTeamConfig,
  type AgentTeamHandoff,
  type AgentTeamRouting,
} from "@/lib/ai/agents/pet-roster";

type AgentTeamDialogProps = {
  configuration: AgentRosterConfiguration;
  initialTeam?: AgentTeamConfig;
  installedSkills: AgentAssignableSkill[];
  onClose: () => void;
  onSave: (team: AgentTeamConfig) => Promise<void>;
  open: boolean;
  saving: boolean;
};

type TeamParticipant = {
  accent: string;
  id: string;
  mention: string;
  name: string;
  roleName: string;
  visualPreset: AgentPetRoleId;
};

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-ui-label text-foreground outline-none transition-colors focus-visible:border-ring";

function FormField({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-ui-caption font-medium text-foreground">
        {label}
      </span>
      {description ? (
        <span className="mt-0.5 block text-ui-caption leading-4 text-muted-foreground">
          {description}
        </span>
      ) : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function mentionSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "team";
}

function normalizeCriteriaInput(value: string): string {
  return value
    .split(/\r?\n/)
    .slice(0, AGENT_ROSTER_LIMITS.completionCriteriaPerTeam)
    .map((line) => line.slice(0, AGENT_ROSTER_LIMITS.completionCriterionChars))
    .join("\n");
}

function criteriaFromInput(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, AGENT_ROSTER_LIMITS.completionCriteriaPerTeam);
}

function participantOptions(
  configuration: AgentRosterConfiguration,
): TeamParticipant[] {
  const builtins = configuration.workflowAgentIds.flatMap((id) => {
    const agent = AGENT_PET_ROSTER.find((candidate) => candidate.id === id);
    if (!agent) return [];
    return [
      {
        accent: agent.accent,
        id: agent.id,
        mention: `@agent:${agent.petName.toLowerCase()}`,
        name: agent.petName,
        roleName: agent.roleName,
        visualPreset: agent.id,
      },
    ];
  });
  const custom = configuration.customAgents.flatMap((agent) => {
    if (!agent.enabled) return [];
    const pet = getAgentPetCatalogDefinition(agent.petId);
    return [
      {
        accent: pet.accent,
        id: agent.id,
        mention: agent.mention,
        name: agent.name,
        roleName: agent.roleName,
        visualPreset: pet.visualPreset,
      },
    ];
  });
  return [...builtins, ...custom];
}

function createDraft(
  configuration: AgentRosterConfiguration,
  initialTeam?: AgentTeamConfig,
): AgentTeamConfig {
  const leadAgentId = configuration.activeAgentId;
  const candidate: AgentTeamConfig =
    initialTeam ??
    ({
      id: "team-delivery",
      mention: "@team:delivery",
      enabled: true,
      name: "Delivery",
      goal: "Deliver the scoped outcome with verified handoffs.",
      leadAgentId,
      memberAgentIds: [leadAgentId],
      sharedSkillIds: [],
      routing: "capability-routed",
      handoff: "lead-mediated",
      escalationPolicy: "risk-or-blocked",
      finalReviewerAgentId: leadAgentId,
      completionCriteria: [
        "All requested outcomes are implemented and verified.",
      ],
    } satisfies AgentTeamConfig);
  const normalized = normalizeAgentRosterConfiguration({
    ...configuration,
    teams: [candidate],
  });
  return normalized.teams[0];
}

export function AgentTeamDialog({
  configuration,
  initialTeam,
  installedSkills,
  onClose,
  onSave,
  open,
  saving,
}: AgentTeamDialogProps) {
  const normalizedConfiguration = useMemo(
    () => normalizeAgentRosterConfiguration(configuration),
    [configuration],
  );
  const participants = useMemo(
    () => participantOptions(normalizedConfiguration),
    [normalizedConfiguration],
  );
  const [draft, setDraft] = useState<AgentTeamConfig>(() =>
    createDraft(normalizedConfiguration, initialTeam),
  );
  const [criteriaInput, setCriteriaInput] = useState(() =>
    draft.completionCriteria.join("\n"),
  );

  const skillOptions = useMemo(() => {
    const byId = new Map<string, AgentAssignableSkill>();
    for (const skill of installedSkills) {
      if (skill.enabled || draft.sharedSkillIds.includes(skill.id)) {
        byId.set(skill.id, skill);
      }
    }
    for (const skillId of draft.sharedSkillIds) {
      if (byId.has(skillId)) continue;
      byId.set(skillId, {
        id: skillId,
        name: skillId,
        description: "Available through RIFT's runtime skill catalog.",
        enabled: true,
        source: "runtime-catalog",
      });
    }
    return [...byId.values()].sort((left, right) => {
      const selectionDelta =
        Number(draft.sharedSkillIds.includes(right.id)) -
        Number(draft.sharedSkillIds.includes(left.id));
      return selectionDelta || left.name.localeCompare(right.name);
    });
  }, [draft.sharedSkillIds, installedSkills]);

  const selectedParticipants = participants.filter((participant) =>
    draft.memberAgentIds.includes(participant.id),
  );
  const completionCriteria = criteriaFromInput(criteriaInput);
  const atTeamLimit =
    !initialTeam &&
    normalizedConfiguration.teams.length >= AGENT_ROSTER_LIMITS.teams;
  const canSave =
    !atTeamLimit &&
    draft.name.trim().length > 0 &&
    draft.goal.trim().length > 0 &&
    selectedParticipants.length > 0 &&
    completionCriteria.length > 0;

  const updateName = (name: string) => {
    setDraft((current) => {
      if (initialTeam) return { ...current, name };
      const slug = mentionSlug(name);
      return {
        ...current,
        id: `team-${slug}`,
        mention: `@team:${slug}`,
        name,
      };
    });
  };

  const toggleMember = (agentId: string) => {
    setDraft((current) => {
      const selected = current.memberAgentIds.includes(agentId);
      if (selected && current.memberAgentIds.length === 1) return current;
      if (
        !selected &&
        current.memberAgentIds.length >= AGENT_ROSTER_LIMITS.membersPerTeam
      ) {
        return current;
      }
      const memberAgentIds = selected
        ? current.memberAgentIds.filter((id) => id !== agentId)
        : [...current.memberAgentIds, agentId];
      const fallback = memberAgentIds[0];
      return {
        ...current,
        memberAgentIds,
        leadAgentId: memberAgentIds.includes(current.leadAgentId)
          ? current.leadAgentId
          : fallback,
        finalReviewerAgentId: memberAgentIds.includes(
          current.finalReviewerAgentId,
        )
          ? current.finalReviewerAgentId
          : fallback,
      };
    });
  };

  const toggleSharedSkill = (skillId: string) => {
    setDraft((current) => {
      const selected = current.sharedSkillIds.includes(skillId);
      if (
        !selected &&
        current.sharedSkillIds.length >= AGENT_ROSTER_LIMITS.sharedSkillsPerTeam
      ) {
        return current;
      }
      return {
        ...current,
        sharedSkillIds: selected
          ? current.sharedSkillIds.filter((id) => id !== skillId)
          : [...current.sharedSkillIds, skillId],
      };
    });
  };

  const submit = async () => {
    if (!canSave || saving) return;
    const otherTeams = normalizedConfiguration.teams.filter(
      (team) => team.id !== initialTeam?.id,
    );
    const normalized = normalizeAgentRosterConfiguration({
      ...normalizedConfiguration,
      teams: [...otherTeams, { ...draft, completionCriteria }].slice(
        0,
        AGENT_ROSTER_LIMITS.teams,
      ),
    });
    const savedTeam = normalized.teams[otherTeams.length];
    if (savedTeam) await onSave(savedTeam);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-[900px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/75 px-5 py-4">
          <div className="flex items-start gap-3 pr-7">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border/75 bg-accent/35 text-foreground">
              <UsersRound aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-ui-section">
                  {initialTeam ? `Edit ${initialTeam.name}` : "Create team"}
                </DialogTitle>
                <code className="rounded border border-border/75 bg-card/30 px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                  {draft.mention}
                </code>
              </div>
              <DialogDescription className="mt-1 text-ui-label leading-5">
                Compose reusable agents into an executable team contract with a
                named lead, bounded handoffs, and explicit completion checks.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="terminal-scrollbar min-h-0 flex-1 overflow-y-auto">
          <section
            aria-labelledby="team-identity-heading"
            className="border-b border-border/70 px-5 py-4"
          >
            <div>
              <h2 className="text-ui font-medium" id="team-identity-heading">
                Team contract
              </h2>
              <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                The goal is injected into the managed runtime skill whenever
                this exact team mention is used.
              </p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr]">
              <FormField label="Team name">
                <Input
                  maxLength={AGENT_ROSTER_LIMITS.nameChars}
                  onChange={(event) => updateName(event.target.value)}
                  value={draft.name}
                />
              </FormField>
              <FormField label="Goal">
                <Input
                  maxLength={AGENT_ROSTER_LIMITS.teamGoalChars}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      goal: event.target.value,
                    }))
                  }
                  value={draft.goal}
                />
              </FormField>
            </div>
          </section>

          <section
            aria-labelledby="team-members-heading"
            className="border-b border-border/70 px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-ui font-medium" id="team-members-heading">
                  Participants
                </h2>
                <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                  Select up to {AGENT_ROSTER_LIMITS.membersPerTeam} enabled
                  built-in or custom agents. At least one participant is
                  required.
                </p>
              </div>
              <span
                className="rounded-md border border-border/80 px-2 py-1 font-mono text-ui-caption text-muted-foreground"
                role="status"
              >
                {draft.memberAgentIds.length}/
                {AGENT_ROSTER_LIMITS.membersPerTeam}
              </span>
            </div>

            <fieldset className="mt-3 grid gap-1.5 sm:grid-cols-2">
              <legend className="sr-only">Team participants</legend>
              {participants.map((participant) => {
                const checked = draft.memberAgentIds.includes(participant.id);
                const lastMember = checked && draft.memberAgentIds.length === 1;
                const atLimit =
                  !checked &&
                  draft.memberAgentIds.length >=
                    AGENT_ROSTER_LIMITS.membersPerTeam;
                return (
                  <label
                    className={`flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${
                      checked
                        ? "border-foreground/20 bg-accent/45"
                        : "border-border/70 bg-card/[0.12]"
                    } ${
                      lastMember || atLimit
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-accent/25"
                    }`}
                    key={participant.id}
                  >
                    <input
                      aria-label={`Include ${participant.name} in team`}
                      checked={checked}
                      className="size-3.5 shrink-0 accent-primary"
                      disabled={lastMember || atLimit}
                      onChange={() => toggleMember(participant.id)}
                      type="checkbox"
                    />
                    <AgentPetAvatar
                      accent={participant.accent}
                      agentName={participant.name}
                      participating={checked}
                      role={participant.visualPreset}
                      roleName={participant.roleName}
                      selected={checked}
                      size={32}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui-caption font-medium text-foreground">
                        {participant.name}
                      </span>
                      <span className="block truncate text-[9.5px] text-muted-foreground">
                        {participant.roleName} · {participant.mention}
                      </span>
                    </span>
                    {checked ? (
                      <Check aria-hidden className="size-3 shrink-0" />
                    ) : null}
                  </label>
                );
              })}
            </fieldset>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField
                description="Owns decomposition, conflict resolution, and the final result."
                label="Team lead"
              >
                <select
                  aria-label="Team lead"
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      leadAgentId: event.target.value,
                    }))
                  }
                  value={draft.leadAgentId}
                >
                  {selectedParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name} — {participant.roleName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                description="Checks the completion criteria before the team reports done."
                label="Final reviewer"
              >
                <select
                  aria-label="Final reviewer"
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      finalReviewerAgentId: event.target.value,
                    }))
                  }
                  value={draft.finalReviewerAgentId}
                >
                  {selectedParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name} — {participant.roleName}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </section>

          <section
            aria-labelledby="team-coordination-heading"
            className="border-b border-border/70 px-5 py-4"
          >
            <div>
              <h2
                className="text-ui font-medium"
                id="team-coordination-heading"
              >
                Coordination
              </h2>
              <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                These settings become explicit delegate_task routing and handoff
                instructions for the named participants.
              </p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <FormField label="Routing">
                <select
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      routing: event.target.value as AgentTeamRouting,
                    }))
                  }
                  value={draft.routing}
                >
                  <option value="lead-routed">Lead routed</option>
                  <option value="capability-routed">Capability routed</option>
                  <option value="parallel">Parallel by default</option>
                  <option value="sequential">Sequential</option>
                </select>
              </FormField>
              <FormField label="Handoff">
                <select
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      handoff: event.target.value as AgentTeamHandoff,
                    }))
                  }
                  value={draft.handoff}
                >
                  <option value="explicit">Explicit evidence handoff</option>
                  <option value="lead-mediated">Lead mediated</option>
                  <option value="automatic">Automatic on completion</option>
                </select>
              </FormField>
              <FormField label="Escalation">
                <select
                  className={SELECT_CLASS}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      escalationPolicy: event.target
                        .value as AgentEscalationPolicy,
                    }))
                  }
                  value={draft.escalationPolicy}
                >
                  <option value="when-blocked">Only when blocked</option>
                  <option value="risk-or-blocked">At risk or blocked</option>
                  <option value="before-every-action">
                    Before every action
                  </option>
                </select>
              </FormField>
            </div>
          </section>

          <div className="grid lg:grid-cols-2">
            <section
              aria-labelledby="team-skills-heading"
              className="border-b border-border/70 px-5 py-4 lg:border-r lg:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-ui font-medium" id="team-skills-heading">
                    Shared skills
                  </h2>
                  <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                    Optional skills available to every team participant.
                  </p>
                </div>
                <span
                  className="rounded-md border border-border/80 px-2 py-1 font-mono text-ui-caption text-muted-foreground"
                  role="status"
                >
                  {draft.sharedSkillIds.length}/
                  {AGENT_ROSTER_LIMITS.sharedSkillsPerTeam}
                </span>
              </div>
              <fieldset className="mt-3 max-h-52 space-y-1.5 overflow-y-auto pr-1">
                <legend className="sr-only">Shared team skills</legend>
                {skillOptions.length > 0 ? (
                  skillOptions.map((skill) => {
                    const checked = draft.sharedSkillIds.includes(skill.id);
                    const atLimit =
                      !checked &&
                      draft.sharedSkillIds.length >=
                        AGENT_ROSTER_LIMITS.sharedSkillsPerTeam;
                    return (
                      <label
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                          checked
                            ? "border-foreground/20 bg-accent/45"
                            : "border-border/70 bg-card/[0.12]"
                        } ${
                          atLimit
                            ? "cursor-not-allowed opacity-55"
                            : "cursor-pointer hover:bg-accent/25"
                        }`}
                        key={skill.id}
                      >
                        <input
                          aria-label={`Share ${skill.name} with team`}
                          checked={checked}
                          className="mt-0.5 size-3.5 accent-primary"
                          disabled={atLimit}
                          onChange={() => toggleSharedSkill(skill.id)}
                          type="checkbox"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui-caption font-medium text-foreground">
                            {skill.name}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-muted-foreground">
                            {skill.id}
                          </span>
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="rounded-md border border-dashed border-border/75 px-3 py-4 text-ui-caption leading-4 text-muted-foreground">
                    No enabled skills are available. The team can still use the
                    skills assigned to each participant.
                  </p>
                )}
              </fieldset>
            </section>

            <section
              aria-labelledby="team-completion-heading"
              className="px-5 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    className="text-ui font-medium"
                    id="team-completion-heading"
                  >
                    Completion criteria
                  </h2>
                  <p
                    className="mt-1 text-ui-caption leading-4 text-muted-foreground"
                    id="team-completion-help"
                  >
                    One observable check per line. The final reviewer evaluates
                    every non-empty line.
                  </p>
                </div>
                <span
                  className="rounded-md border border-border/80 px-2 py-1 font-mono text-ui-caption text-muted-foreground"
                  role="status"
                >
                  {completionCriteria.length}/
                  {AGENT_ROSTER_LIMITS.completionCriteriaPerTeam}
                </span>
              </div>
              <Textarea
                aria-describedby="team-completion-help"
                aria-invalid={completionCriteria.length === 0}
                aria-label="Completion criteria"
                className="mt-3 min-h-36 resize-y text-ui-caption leading-5"
                onChange={(event) =>
                  setCriteriaInput(normalizeCriteriaInput(event.target.value))
                }
                placeholder={
                  "Typecheck and focused tests pass.\nThe primary workflow is verified in the running app."
                }
                value={criteriaInput}
              />
              {completionCriteria.length === 0 ? (
                <p
                  className="mt-2 text-ui-caption text-destructive"
                  role="alert"
                >
                  Add at least one observable completion criterion.
                </p>
              ) : null}
            </section>
          </div>
        </div>

        <DialogFooter className="flex-row items-center border-t border-border/75 px-5 py-3 sm:justify-between">
          <div className="hidden items-center gap-1.5 text-[9.5px] text-muted-foreground sm:flex">
            <ShieldCheck aria-hidden className="size-3" />
            Runtime normalizes participants, limits, IDs, and handoffs before
            save.
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={onClose} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              className="gap-1.5"
              disabled={!canSave || saving}
              onClick={() => void submit()}
              size="sm"
              type="button"
            >
              <UsersRound aria-hidden className="size-3.5" />
              {saving ? "Syncing…" : initialTeam ? "Save team" : "Create team"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
