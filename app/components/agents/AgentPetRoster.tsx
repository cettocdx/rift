"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Save } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AGENT_PET_ROSTER,
  AGENT_ROSTER_STORAGE_KEY,
  DEFAULT_AGENT_ROSTER_SELECTION,
  MANAGED_AGENT_ROSTER_SKILL_ID,
  agentRosterSelectionsEqual,
  getAgentPetDefinition,
  normalizeAgentRosterSelection,
  parseAgentRosterSkillInstructions,
  renderAgentRosterSkillInstructions,
  serializeAgentRosterSelection,
  type AgentPetRoleId,
  type AgentRosterSelection,
} from "@/lib/ai/agents/pet-roster";
import { AgentPetAvatar } from "./AgentPetAvatar";

function cloneDefaultSelection(): AgentRosterSelection {
  return {
    ...DEFAULT_AGENT_ROSTER_SELECTION,
    workflowAgentIds: [...DEFAULT_AGENT_ROSTER_SELECTION.workflowAgentIds],
  };
}

function readLocalSelection(): AgentRosterSelection | null {
  try {
    const serialized = window.localStorage.getItem(AGENT_ROSTER_STORAGE_KEY);
    if (!serialized) return null;
    return normalizeAgentRosterSelection(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function writeLocalSelection(selection: AgentRosterSelection): void {
  try {
    window.localStorage.setItem(
      AGENT_ROSTER_STORAGE_KEY,
      serializeAgentRosterSelection(selection),
    );
  } catch {
    // Convex remains the source of truth when storage is unavailable.
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The agent crew could not be saved.";
}

function AgentRosterSkeleton() {
  return (
    <section
      aria-label="Loading agent crew"
      className="space-y-3 border-b border-border/70 pb-6"
    >
      <div className="h-5 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="h-[118px] animate-pulse rounded-xl border border-border/60 bg-muted/30 motion-reduce:animate-none"
            key={index}
          />
        ))}
      </div>
    </section>
  );
}

export function AgentPetRoster() {
  const installedSkills = useQuery(api.skills.listForUser, {});
  const syncAgentRoster = useMutation(api.skills.syncAgentRoster);
  const managedRosterSkill = installedSkills?.find(
    (skill) => skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID,
  );

  const didHydrate = useRef(false);
  const [draft, setDraft] = useState<AgentRosterSelection>(
    cloneDefaultSelection,
  );
  const [saved, setSaved] = useState<AgentRosterSelection>(
    cloneDefaultSelection,
  );
  const [hydrated, setHydrated] = useState(false);
  const [hasRuntimeSkill, setHasRuntimeSkill] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (didHydrate.current || installedSkills === undefined) return;
    didHydrate.current = true;

    const fromRuntime = parseAgentRosterSkillInstructions(
      managedRosterSkill?.instructions,
    );
    const selection =
      fromRuntime ?? readLocalSelection() ?? cloneDefaultSelection();
    setDraft(selection);
    setSaved(selection);
    setHasRuntimeSkill(Boolean(managedRosterSkill?.enabled));
    setHydrated(true);
  }, [installedSkills, managedRosterSkill]);

  useEffect(() => {
    if (managedRosterSkill) {
      setHasRuntimeSkill(managedRosterSkill.enabled);
    }
  }, [managedRosterSkill]);

  const dirty = !agentRosterSelectionsEqual(draft, saved);
  const activeAgent = getAgentPetDefinition(draft.activeAgentId);

  const selectDefaultAgent = (agentId: AgentPetRoleId) => {
    setDraft((current) =>
      normalizeAgentRosterSelection({
        ...current,
        activeAgentId: agentId,
        workflowAgentIds: current.workflowAgentIds.includes(agentId)
          ? current.workflowAgentIds
          : [...current.workflowAgentIds, agentId],
      }),
    );
    setSaveError(null);
  };

  const setWorkflowParticipation = (
    agentId: AgentPetRoleId,
    participating: boolean,
  ) => {
    setDraft((current) => {
      if (agentId === current.activeAgentId) return current;
      const selected = new Set(current.workflowAgentIds);
      if (participating) selected.add(agentId);
      else selected.delete(agentId);
      return normalizeAgentRosterSelection({
        ...current,
        workflowAgentIds: AGENT_PET_ROSTER.filter((agent) =>
          selected.has(agent.id),
        ).map((agent) => agent.id),
      });
    });
    setSaveError(null);
  };

  const saveCrew = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const instructions = renderAgentRosterSkillInstructions(draft);
      const result = await syncAgentRoster({
        description: `${activeAgent.petName} is the default lead. ${draft.workflowAgentIds.length} pets can join matching workflows.`,
        instructions,
      });
      if (!result.success) {
        throw new Error(result.error ?? "The agent crew could not be saved.");
      }
      writeLocalSelection(draft);
      setSaved(draft);
      setHasRuntimeSkill(true);
      toast.success("Agent crew synced to the runtime");
    } catch (error) {
      const message = messageFromError(error);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!hydrated) return <AgentRosterSkeleton />;

  return (
    <section
      aria-labelledby="agent-crew-heading"
      className="space-y-4 border-b border-border/70 pb-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id="agent-crew-heading" className="text-sm font-medium">
              Agent crew
            </h3>
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-ui-caption font-medium",
                dirty
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : hasRuntimeSkill
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-muted/45 text-muted-foreground",
              )}
              role="status"
            >
              {dirty
                ? "Unsaved changes"
                : hasRuntimeSkill
                  ? "Runtime ready"
                  : "Ready to add"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Pick the default lead and the specialists RIFT may bring into a
            matching workflow. Only relevant specialists are called for each
            run.
          </p>
        </div>
        <Button
          className="h-8 shrink-0 gap-1.5 rounded-md text-xs"
          disabled={saving || (!dirty && hasRuntimeSkill)}
          onClick={saveCrew}
          size="sm"
          type="button"
        >
          <Save className="size-3.5" aria-hidden />
          {saving
            ? "Syncing..."
            : hasRuntimeSkill
              ? "Save crew"
              : "Add to runtime"}
        </Button>
      </div>

      {saveError && (
        <div
          className="rounded-lg border border-destructive/35 bg-destructive/8 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
        {AGENT_PET_ROSTER.map((agent) => {
          const isActive = draft.activeAgentId === agent.id;
          const participates = draft.workflowAgentIds.includes(agent.id);
          const colorStyle = {
            "--pet-accent": agent.accent,
          } as CSSProperties;

          return (
            <article
              className={cn(
                "relative overflow-hidden rounded-xl border bg-card/25 transition-colors duration-(--duration-hover) before:absolute before:inset-y-0 before:left-0 before:w-0 before:bg-[var(--pet-accent)] before:transition-[width] before:duration-150",
                isActive
                  ? "border-[color:color-mix(in_srgb,var(--pet-accent)_68%,var(--border))] bg-accent/35 before:w-0.5"
                  : "border-border/70 hover:border-border hover:bg-card/45",
              )}
              data-agent-id={agent.id}
              data-selected={isActive || undefined}
              key={agent.id}
              style={colorStyle}
            >
              <button
                aria-label={`Make ${agent.petName} the default agent`}
                aria-pressed={isActive}
                className="group flex w-full cursor-pointer items-start gap-3 p-3 text-left outline-none transition-colors duration-(--duration-hover)"
                onClick={() => selectDefaultAgent(agent.id)}
                type="button"
              >
                <AgentPetAvatar
                  accent={agent.accent}
                  agentName={agent.petName}
                  participating={participates}
                  role={agent.id}
                  roleName={agent.roleName}
                  selected={isActive}
                />

                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block text-ui font-medium leading-4">
                        {agent.petName}
                      </span>
                      <span className="mt-0.5 block text-ui-caption font-medium text-muted-foreground">
                        {agent.roleName}
                      </span>
                    </span>
                    {isActive && (
                      <span className="flex shrink-0 items-center gap-1 text-ui-caption font-medium text-foreground">
                        <Check
                          className="size-3"
                          strokeWidth={2.2}
                          aria-hidden
                        />
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-ui-caption leading-4 text-muted-foreground">
                    {agent.description}
                  </span>
                </span>
              </button>

              <div
                className={cn(
                  "flex items-center justify-between border-t border-border/60 px-3 py-2 transition-colors duration-(--duration-hover)",
                  participates
                    ? "bg-[color:color-mix(in_srgb,var(--pet-accent)_5%,transparent)]"
                    : "bg-muted/15",
                )}
              >
                <label
                  className={cn(
                    "text-ui-caption font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                  htmlFor={`workflow-${agent.id}`}
                >
                  {isActive ? "Default always joins" : "Join matching work"}
                </label>
                <Switch
                  aria-label={`Include ${agent.petName} in matching workflows`}
                  checked={participates}
                  disabled={isActive}
                  id={`workflow-${agent.id}`}
                  onCheckedChange={(checked) =>
                    setWorkflowParticipation(agent.id, checked)
                  }
                />
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="flex items-center gap-2.5">
            <AgentPetAvatar
              accent={activeAgent.accent}
              agentName={activeAgent.petName}
              className="hidden min-[420px]:inline-grid"
              participating
              role={activeAgent.id}
              roleName={activeAgent.roleName}
              selected
              size={38}
            />
            <div>
              <h4 className="text-ui font-medium">
                {activeAgent.petName} leads as {activeAgent.roleName}
              </h4>
              <p className="mt-0.5 text-ui-caption leading-4 text-muted-foreground">
                {draft.workflowAgentIds.length} of {AGENT_PET_ROSTER.length}{" "}
                pets can join when their responsibility matches the task.
              </p>
            </div>
          </div>
          <span className="mt-1 text-ui-caption font-medium text-muted-foreground sm:mt-0">
            Server-synced skill contract
          </span>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="text-ui-caption font-medium text-foreground">
              Responsibilities
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {activeAgent.responsibilities.map((responsibility) => (
                <li
                  className="flex items-start gap-2 text-ui-caption leading-4 text-muted-foreground"
                  key={responsibility}
                >
                  <Check
                    className="mt-0.5 size-3 shrink-0 text-foreground"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>{responsibility}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-ui-caption font-medium text-foreground">
              Loaded role skills
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activeAgent.skillIds.map((skillId) => (
                <code
                  className="rounded-md border border-border/70 bg-background/55 px-1.5 py-1 text-ui-caption leading-none text-muted-foreground"
                  key={skillId}
                >
                  {skillId}
                </code>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
