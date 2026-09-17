"use client";

import { useCallback, useMemo, useState } from "react";
import { observeChatViewport } from "@/app/components/chat-layout/ChatViewport";
import { Bot, Check, ChevronRight, Plug, ShieldCheck } from "lucide-react";

import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import { EffectivePermissionsPanel } from "@/app/components/agents/EffectivePermissionsPanel";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_PET_CATALOG,
  AGENT_ROSTER_LIMITS,
  DEFAULT_AGENT_ROSTER_SELECTION,
  getAgentPetCatalogDefinition,
  isAgentPetCatalogId,
  normalizeAgentRosterConfiguration,
  type AgentApprovalPolicy,
  type AgentAutonomy,
  type AgentEscalationPolicy,
  type AgentMemoryScope,
  type AgentPermissionPreset,
  type AgentPetCatalogId,
  type AgentReasoningEffort,
  type AgentSkillAssignmentMode,
  type CustomAgentProfileConfig,
} from "@/lib/ai/agents/pet-roster";
import {
  BUILD_MODELS,
  REASONING_EFFORTS,
  REASONING_EFFORT_LABELS,
  resolveBuildReasoningEffort,
} from "@/types/chat";

export type AgentAssignableSkill = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: "installed" | "runtime-catalog";
};

export type AgentAssignableMcpServer = {
  id: string;
  name: string;
  enabled: boolean;
  connectionStatus: "verified" | "needs_attention" | "unknown";
};

type AgentProfileDialogProps = {
  initialPetId?: AgentPetCatalogId;
  initialProfile?: CustomAgentProfileConfig;
  installedSkills: AgentAssignableSkill[];
  mcpServers: AgentAssignableMcpServer[];
  onClose: () => void;
  onSave: (profile: CustomAgentProfileConfig) => Promise<void>;
  /** Saves the agent, then launches a scratch chat that runs the test prompt. */
  onSaveAndTest?: (
    profile: CustomAgentProfileConfig,
    testPrompt: string,
  ) => Promise<void>;
  open: boolean;
  saving: boolean;
  /** Project bots keep an exact, focused skill pack; legacy agents retain the minimum. */
  minSkills?: number;
};

type ProfileSection = "identity" | "runtime" | "access" | "skills" | "review";

const PROFILE_SECTIONS: ReadonlyArray<{
  id: ProfileSection;
  label: string;
  description: string;
}> = [
  { id: "identity", label: "Identity", description: "Pet, role, and mission" },
  {
    id: "runtime",
    label: "Runtime",
    description: "Model, reasoning, and parallel tasks",
  },
  { id: "access", label: "Access", description: "Tools and permissions" },
  { id: "skills", label: "Skills", description: "Specialist instructions" },
  {
    id: "review",
    label: "Review & test",
    description: "Confirm effective access, then try it",
  },
];

const TOOL_OPTIONS = [
  {
    id: "find_skills",
    label: "Skill discovery",
    description: "Run the read-only Build capability discovery step.",
  },
  {
    id: "file",
    label: "Files",
    description: "Read and edit workspace files when permission allows.",
  },
  {
    id: "run_terminal_cmd",
    label: "Terminal",
    description:
      "Run scoped commands through the active sandbox or local bridge.",
  },
  {
    id: "todo_write",
    label: "Task plan",
    description: "Maintain structured implementation progress.",
  },
  {
    id: "delegate_task",
    label: "Delegation",
    description: "Coordinate isolated sub-agent work in Build mode.",
  },
  {
    id: "verify_app",
    label: "Preview verification",
    description: "Inspect a real running application when available.",
  },
  {
    id: "expose_preview",
    label: "Preview publishing",
    description: "Expose a live app only after its verification proof passes.",
  },
  {
    id: "open_url",
    label: "URL inspection",
    description: "Read approved web resources when the runtime is configured.",
  },
  {
    id: "browse_url",
    label: "Isolated browser",
    description:
      "Render public HTTPS pages in a read-only RIFT profile; local access needs a separate desktop grant.",
  },
  {
    id: "desktop_access_status",
    label: "Desktop connection",
    description: "Check the signed-in Mac connection and permissions.",
  },
  {
    id: "desktop_screenshot",
    label: "Observe Mac",
    description:
      "View the main display with the user’s Screen Recording grant.",
  },
  {
    id: "desktop_computer_action",
    label: "Control Mac",
    description:
      "Use the mouse and keyboard after observing the screen. Requires a separate native grant.",
  },
  {
    id: "open_browser_page",
    label: "Open visible browser",
    description: "Open a page on the Mac with native confirmation.",
  },
  {
    id: "web_search",
    label: "Web research",
    description: "Search current sources when the provider is configured.",
  },
  {
    id: "generate_image",
    label: "Image generation",
    description: "Generate visual assets through configured models.",
  },
] as const;

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-ui-label text-foreground outline-none transition-colors focus-visible:border-ring";

function createDefaultProfile(
  petId: AgentPetCatalogId,
): CustomAgentProfileConfig {
  const pet = getAgentPetCatalogDefinition(petId);
  return normalizeAgentRosterConfiguration({
    ...DEFAULT_AGENT_ROSTER_SELECTION,
    customAgents: [
      {
        name: pet.petName,
        petId,
        roleName: pet.roleName,
        mission: pet.mission,
        skillIds: pet.suggestedSkillIds,
        toolIds: [
          "find_skills",
          "file",
          "run_terminal_cmd",
          "todo_write",
          "delegate_task",
          "verify_app",
          "expose_preview",
          "browse_url",
        ],
      },
    ],
  }).customAgents[0];
}

function FormField({
  children,
  description,
  label,
}: {
  children: React.ReactNode;
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

function SegmentControl<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
}) {
  return (
    <div>
      <div className="text-ui-caption font-medium text-foreground">{label}</div>
      <div
        aria-label={label}
        className="mt-1.5 flex w-fit max-w-full gap-0.5 rounded-md border border-border/80 bg-card/20 p-0.5"
        role="group"
      >
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={`rounded-[4px] px-2.5 py-1.5 text-ui-caption font-medium transition-colors focus-visible:outline-none ${
              value === option.value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentProfileDialog({
  initialPetId = "dog",
  initialProfile,
  installedSkills,
  mcpServers,
  onClose,
  onSave,
  onSaveAndTest,
  open,
  saving,
  minSkills = AGENT_ROSTER_LIMITS.minSkillsPerAgent,
}: AgentProfileDialogProps) {
  const [section, setSection] = useState<ProfileSection>("identity");
  const [testPrompt, setTestPrompt] = useState("");
  const stepIndex = PROFILE_SECTIONS.findIndex((item) => item.id === section);
  const isFirstStep = stepIndex <= 0;
  const isReviewStep = section === "review";
  const goToStep = (delta: number) => {
    const next = PROFILE_SECTIONS[stepIndex + delta];
    if (next) setSection(next.id);
  };
  const [draft, setDraft] = useState<CustomAgentProfileConfig>(() =>
    initialProfile
      ? structuredClone(initialProfile)
      : createDefaultProfile(initialPetId),
  );
  const pet = getAgentPetCatalogDefinition(draft.petId);
  const attachDialog = useCallback((node: HTMLDivElement | null) => {
    if (node) return observeChatViewport(node);
  }, []);
  const configuredBuildModel = BUILD_MODELS.find(
    (model) => model.id === draft.model,
  );
  const reasoningOptions: readonly AgentReasoningEffort[] =
    configuredBuildModel?.reasoning.supportedEfforts ?? REASONING_EFFORTS;
  const displayedReasoningEffort = configuredBuildModel
    ? resolveBuildReasoningEffort(
        configuredBuildModel.id,
        draft.reasoningEffort,
      )
    : draft.reasoningEffort;

  const skillOptions = useMemo(() => {
    const byId = new Map<string, AgentAssignableSkill>();
    for (const skill of installedSkills) byId.set(skill.id, skill);
    for (const skillId of [...pet.suggestedSkillIds, ...draft.skillIds]) {
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
      const selectedDelta =
        Number(draft.skillIds.includes(right.id)) -
        Number(draft.skillIds.includes(left.id));
      return selectedDelta || left.name.localeCompare(right.name);
    });
  }, [draft.skillIds, installedSkills, pet.suggestedSkillIds]);

  const mcpOptions = useMemo(() => {
    const byId = new Map(mcpServers.map((server) => [server.id, server]));
    for (const serverId of draft.mcpServerIds) {
      if (byId.has(serverId)) continue;
      byId.set(serverId, {
        id: serverId,
        name: serverId,
        enabled: false,
        connectionStatus: "unknown",
      });
    }
    return [...byId.values()].sort((left, right) => {
      const selectedDelta =
        Number(draft.mcpServerIds.includes(right.id)) -
        Number(draft.mcpServerIds.includes(left.id));
      return selectedDelta || left.name.localeCompare(right.name);
    });
  }, [draft.mcpServerIds, mcpServers]);

  const canSave =
    draft.name.trim().length > 0 &&
    draft.roleName.trim().length > 0 &&
    draft.mission.trim().length > 0 &&
    draft.skillIds.length >= minSkills &&
    draft.skillIds.length <= AGENT_ROSTER_LIMITS.maxSkillsPerAgent;

  const updatePet = (petId: AgentPetCatalogId) => {
    const nextPet = getAgentPetCatalogDefinition(petId);
    setDraft((current) => ({
      ...current,
      petId,
      name: nextPet.petName,
      roleName: nextPet.roleName,
      mission: nextPet.mission,
      skillIds: [...nextPet.suggestedSkillIds],
    }));
  };

  const toggleSkill = (skillId: string) => {
    setDraft((current) => {
      const selected = current.skillIds.includes(skillId);
      if (
        !selected &&
        current.skillIds.length >= AGENT_ROSTER_LIMITS.maxSkillsPerAgent
      ) {
        return current;
      }
      return {
        ...current,
        skillIds: selected
          ? current.skillIds.filter((id) => id !== skillId)
          : [...current.skillIds, skillId],
      };
    });
  };

  const toggleMcpServer = (serverId: string) => {
    setDraft((current) => {
      const selected = current.mcpServerIds.includes(serverId);
      if (
        !selected &&
        current.mcpServerIds.length >= AGENT_ROSTER_LIMITS.mcpServersPerAgent
      ) {
        return current;
      }
      return {
        ...current,
        mcpServerIds: selected
          ? current.mcpServerIds.filter((id) => id !== serverId)
          : [...current.mcpServerIds, serverId],
      };
    });
  };

  const toggleTool = (toolId: string) => {
    setDraft((current) => ({
      ...current,
      toolIds: current.toolIds.includes(toolId)
        ? current.toolIds.filter((id) => id !== toolId)
        : [...current.toolIds, toolId].slice(
            0,
            AGENT_ROSTER_LIMITS.toolsPerAgent,
          ),
    }));
  };

  const submit = async (launchTestPrompt?: string) => {
    if (!canSave || saving) return;
    const runtimeSafeDraft = configuredBuildModel
      ? { ...draft, reasoningEffort: displayedReasoningEffort }
      : draft;
    const normalized = normalizeAgentRosterConfiguration({
      ...DEFAULT_AGENT_ROSTER_SELECTION,
      customAgents: [runtimeSafeDraft],
    }).customAgents[0];
    if (minSkills === 0) {
      normalized.skillIds = [...new Set(runtimeSafeDraft.skillIds)].slice(
        0,
        AGENT_ROSTER_LIMITS.maxSkillsPerAgent,
      );
    }
    if (launchTestPrompt && onSaveAndTest) {
      await onSaveAndTest(normalized, launchTestPrompt);
      return;
    }
    await onSave(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        ref={attachDialog}
        style={{
          top: "calc(var(--rift-chat-viewport-offset, 0px) + var(--rift-chat-viewport-height, 100%) / 2)",
        }}
        className="flex h-[var(--rift-chat-viewport-height,100dvh)] max-h-[var(--rift-chat-viewport-height,100dvh)] w-[100vw] max-w-[100vw] flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(94dvh,var(--rift-chat-viewport-height,94dvh))] sm:max-h-[min(94dvh,var(--rift-chat-viewport-height,94dvh))] sm:w-[min(1100px,94vw)] sm:max-w-[min(1100px,94vw)] sm:rounded-lg sm:border"
      >
        <DialogHeader className="shrink-0 border-b border-border/75 px-4 py-2 sm:px-5 sm:py-4">
          <div className="flex items-start gap-3">
            <AgentPetAvatar
              accent={pet.accent}
              agentName={draft.name}
              label={`${pet.speciesLabel} agent template`}
              participating={draft.enabled}
              role={pet.visualPreset}
              roleName={draft.roleName}
              selected
              size={44}
            />
            <div className="min-w-0">
              <DialogTitle className="text-ui-section">
                {initialProfile
                  ? `Edit ${initialProfile.name}`
                  : "Create agent"}
              </DialogTitle>
              <DialogDescription className="sr-only mt-1 text-ui-label leading-5 sm:not-sr-only">
                Choose this agent’s role, skills, and tools for Build tasks.
              </DialogDescription>
              <p
                className="sr-only mt-2 text-ui-caption font-medium text-muted-foreground sm:not-sr-only"
                aria-live="polite"
              >
                Step {stepIndex + 1} of {PROFILE_SECTIONS.length} ·{" "}
                {PROFILE_SECTIONS[stepIndex]?.label}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[180px_1fr] md:grid-rows-1">
          <nav
            aria-label="Agent configuration sections"
            className="border-b border-border/75 bg-card/[0.12] p-2 md:border-b-0 md:border-r"
          >
            <select
              aria-label="Agent configuration section"
              className={`${SELECT_CLASS} min-h-11 md:hidden`}
              value={section}
              onChange={(event) =>
                setSection(event.target.value as ProfileSection)
              }
            >
              {PROFILE_SECTIONS.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.label}
                </option>
              ))}
            </select>
            <div className="hidden gap-1 md:grid md:grid-cols-1">
              {PROFILE_SECTIONS.map((item) => (
                <button
                  aria-current={section === item.id ? "step" : undefined}
                  className={`group flex min-h-11 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors focus-visible:outline-none ${
                    section === item.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui-label font-medium">
                      {item.label}
                    </span>
                    <span className="mt-0.5 hidden truncate text-[9.5px] text-muted-foreground md:block">
                      {item.description}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="hidden size-3 opacity-60 md:block"
                  />
                </button>
              ))}
            </div>
          </nav>

          <div className="terminal-scrollbar min-h-0 overflow-y-auto px-5 py-4">
            {section === "identity" ? (
              <section
                aria-labelledby="agent-identity-heading"
                className="space-y-4"
              >
                <div>
                  <h2
                    className="text-ui font-medium"
                    id="agent-identity-heading"
                  >
                    Identity and mission
                  </h2>
                  <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                    Start with a role template, then customize its name and
                    mission.
                  </p>
                </div>

                <FormField label="Pet archetype">
                  <select
                    className={SELECT_CLASS}
                    onChange={(event) => {
                      if (isAgentPetCatalogId(event.target.value)) {
                        updatePet(event.target.value);
                      }
                    }}
                    value={draft.petId}
                  >
                    {AGENT_PET_CATALOG.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.speciesLabel} — {option.roleName}
                      </option>
                    ))}
                  </select>
                </FormField>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Agent name">
                    <Input
                      maxLength={AGENT_ROSTER_LIMITS.nameChars}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={draft.name}
                    />
                  </FormField>
                  <FormField label="Professional role">
                    <Input
                      maxLength={AGENT_ROSTER_LIMITS.roleChars}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          roleName: event.target.value,
                        }))
                      }
                      value={draft.roleName}
                    />
                  </FormField>
                </div>

                <FormField label="Mission">
                  <Textarea
                    className="min-h-20 resize-y text-ui-label"
                    maxLength={AGENT_ROSTER_LIMITS.missionChars}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        mission: event.target.value,
                      }))
                    }
                    value={draft.mission}
                  />
                </FormField>

                <FormField
                  description="Used for status updates, questions, and handoffs."
                  label="Communication style"
                >
                  <Input
                    maxLength={AGENT_ROSTER_LIMITS.communicationStyleChars}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        communicationStyle: event.target.value,
                      }))
                    }
                    value={draft.communicationStyle}
                  />
                </FormField>
              </section>
            ) : null}

            {section === "runtime" ? (
              <section
                aria-labelledby="agent-runtime-heading"
                className="space-y-4"
              >
                <div>
                  <h2
                    className="text-ui font-medium"
                    id="agent-runtime-heading"
                  >
                    Runtime behavior
                  </h2>
                  <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                    Model, supported reasoning effort, identity, and per-run
                    delegated concurrency are applied by the server. Autonomy
                    remains behavioral guidance.
                  </p>
                </div>

                <SegmentControl<AgentAutonomy>
                  label="Autonomy guidance (advisory)"
                  onChange={(autonomy) =>
                    setDraft((current) => ({ ...current, autonomy }))
                  }
                  options={[
                    { value: "guided", label: "Guided" },
                    { value: "balanced", label: "Balanced" },
                    { value: "autonomous", label: "Autonomous" },
                  ]}
                  value={draft.autonomy}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Model">
                    <select
                      className={SELECT_CLASS}
                      onChange={(event) => {
                        const model = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          model,
                          reasoningEffort:
                            model === "auto"
                              ? current.reasoningEffort
                              : resolveBuildReasoningEffort(
                                  model,
                                  current.reasoningEffort,
                                ),
                        }));
                      }}
                      value={draft.model}
                    >
                      <option value="auto">Workspace default</option>
                      {BUILD_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.model} — {model.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    description="Overrides the workspace reasoning control whenever this @agent profile is active."
                    label="Reasoning effort"
                  >
                    <select
                      className={SELECT_CLASS}
                      disabled={reasoningOptions.length === 1}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          reasoningEffort: event.target
                            .value as AgentReasoningEffort,
                        }))
                      }
                      value={displayedReasoningEffort}
                    >
                      {reasoningOptions.map((effort) => (
                        <option key={effort} value={effort}>
                          {REASONING_EFFORT_LABELS[effort]}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <FormField
                  description="Maximum independent delegated tasks this profile may own within one run."
                  label="Task concurrency"
                >
                  <input
                    aria-label="Task concurrency"
                    className="h-2 w-full cursor-pointer accent-primary"
                    max={AGENT_ROSTER_LIMITS.concurrency}
                    min={1}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        concurrencyLimit: Number(event.target.value),
                      }))
                    }
                    type="range"
                    value={draft.concurrencyLimit}
                  />
                  <span className="mt-1 block font-mono text-ui-caption text-muted-foreground">
                    {draft.concurrencyLimit} parallel{" "}
                    {draft.concurrencyLimit === 1 ? "task" : "tasks"}
                  </span>
                </FormField>
              </section>
            ) : null}

            {section === "access" ? (
              <section
                aria-labelledby="agent-access-heading"
                className="space-y-4"
              >
                <div>
                  <h2 className="text-ui font-medium" id="agent-access-heading">
                    Access and approval boundaries
                  </h2>
                  <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                    Choose which tools and connections this agent can use.
                    Settings marked advisory guide its instructions.
                  </p>
                </div>

                <FormField label="Runtime permission ceiling">
                  <select
                    className={SELECT_CLASS}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        permissionPreset: event.target
                          .value as AgentPermissionPreset,
                      }))
                    }
                    value={draft.permissionPreset}
                  >
                    <option value="read-only">
                      Read only — inspect and advise
                    </option>
                    <option value="workspace-write">
                      Workspace write — isolated workspace
                    </option>
                    <option value="trusted">
                      Trusted workspace — available runtime tools
                    </option>
                  </select>
                </FormField>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Repository context (advisory)">
                    <Input
                      maxLength={AGENT_ROSTER_LIMITS.workspaceChars}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          repository: event.target.value,
                        }))
                      }
                      placeholder="current repository"
                      value={draft.repository}
                    />
                  </FormField>
                  <FormField label="Folder context (advisory)">
                    <Input
                      maxLength={AGENT_ROSTER_LIMITS.workspaceChars}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          folder: event.target.value,
                        }))
                      }
                      placeholder="."
                      value={draft.folder}
                    />
                  </FormField>
                </div>

                <div>
                  <div className="text-ui-caption font-medium text-foreground">
                    Tool access
                  </div>
                  <p className="mt-0.5 text-ui-caption leading-4 text-muted-foreground">
                    Enforced for an exactly mentioned profile in the main run.
                    Read-only overrides checked tools that execute, write,
                    publish, verify builds, or change stored state. Bounded
                    delegated specialists remain tool-less.
                  </p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {TOOL_OPTIONS.map((tool) => {
                      const checked = draft.toolIds.includes(tool.id);
                      return (
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                            checked
                              ? "border-foreground/20 bg-accent/45"
                              : "border-border/70 bg-card/[0.12] hover:bg-accent/25"
                          }`}
                          key={tool.id}
                        >
                          <input
                            checked={checked}
                            className="mt-0.5 size-3.5 accent-primary"
                            onChange={() => toggleTool(tool.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0">
                            <span className="block text-ui-caption font-medium text-foreground">
                              {tool.label}
                            </span>
                            <span className="mt-0.5 block text-[9.5px] leading-4 text-muted-foreground">
                              {tool.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-ui-caption font-medium text-foreground">
                        <Plug aria-hidden className="size-3" />
                        MCP connections
                      </div>
                      <p className="mt-0.5 text-ui-caption leading-4 text-muted-foreground">
                        Only your enabled connections can be used. Read-only
                        profiles receive tools marked read-only.
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
                      {draft.mcpServerIds.length}/
                      {AGENT_ROSTER_LIMITS.mcpServersPerAgent}
                    </span>
                  </div>
                  {mcpOptions.length > 0 ? (
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {mcpOptions.map((server) => {
                        const checked = draft.mcpServerIds.includes(server.id);
                        const available =
                          server.enabled &&
                          server.connectionStatus === "verified";
                        const atLimit =
                          !checked &&
                          draft.mcpServerIds.length >=
                            AGENT_ROSTER_LIMITS.mcpServersPerAgent;
                        return (
                          <label
                            className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${
                              checked
                                ? "border-foreground/20 bg-accent/45"
                                : "border-border/70 bg-card/[0.12]"
                            } ${!available && !checked ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
                            key={server.id}
                          >
                            <input
                              checked={checked}
                              className="mt-0.5 size-3.5 accent-primary"
                              disabled={atLimit || (!available && !checked)}
                              onChange={() => toggleMcpServer(server.id)}
                              type="checkbox"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-ui-caption font-medium text-foreground">
                                {server.name}
                              </span>
                              <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                                {server.id}
                              </span>
                              <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                                {available
                                  ? "Verified and enabled"
                                  : checked
                                    ? "Unavailable saved ID — deselect to remove"
                                    : "Unavailable"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 rounded-md border border-border/70 bg-card/[0.12] px-3 py-2 text-ui-caption text-muted-foreground">
                      No verified MCP connections are available. Connect one in
                      Plugins before assigning it to this profile.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Approval guidance (advisory)">
                    <select
                      className={SELECT_CLASS}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          approvalPolicy: event.target
                            .value as AgentApprovalPolicy,
                        }))
                      }
                      value={draft.approvalPolicy}
                    >
                      <option value="always">Ask before every action</option>
                      <option value="risky-actions">
                        Ask for risky actions
                      </option>
                      <option value="on-escalation">Ask on escalation</option>
                    </select>
                  </FormField>
                  <FormField label="Escalation guidance (advisory)">
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
                      <option value="risk-or-blocked">
                        At risk or when blocked
                      </option>
                      <option value="before-every-action">
                        Before every action
                      </option>
                    </select>
                  </FormField>
                </div>

                <div className="rounded-md border border-border/75 bg-card/[0.14] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-ui-caption font-medium text-foreground">
                        Memory guidance (advisory)
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-muted-foreground">
                        Added to instructions; this is not a separate durable
                        per-agent store.
                      </div>
                    </div>
                    <Switch
                      aria-label="Enable agent memory"
                      checked={draft.memory.enabled}
                      onCheckedChange={(enabled) =>
                        setDraft((current) => ({
                          ...current,
                          memory: { ...current.memory, enabled },
                        }))
                      }
                    />
                  </div>
                  {draft.memory.enabled ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                      <FormField label="Suggested memory scope">
                        <select
                          className={SELECT_CLASS}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              memory: {
                                ...current.memory,
                                scope: event.target.value as AgentMemoryScope,
                              },
                            }))
                          }
                          value={draft.memory.scope}
                        >
                          <option value="session">Session</option>
                          <option value="repository">Repository</option>
                          <option value="shared">Shared team context</option>
                        </select>
                      </FormField>
                      <FormField label="Memory instruction guidance">
                        <Input
                          maxLength={
                            AGENT_ROSTER_LIMITS.memoryInstructionsChars
                          }
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              memory: {
                                ...current.memory,
                                instructions: event.target.value,
                              },
                            }))
                          }
                          value={draft.memory.instructions}
                        />
                      </FormField>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {section === "skills" ? (
              <section
                aria-labelledby="agent-skills-heading"
                className="space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2
                      className="text-ui font-medium"
                      id="agent-skills-heading"
                    >
                      Skill guidance (advisory)
                    </h2>
                    <p className="mt-1 max-w-xl text-ui-caption leading-4 text-muted-foreground">
                      Choose four to eight real installed or runtime-catalog
                      instruction packs. Tool availability is enforced
                      separately by the server.
                    </p>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-1 font-mono text-ui-caption ${
                      draft.skillIds.length < minSkills
                        ? "border-amber-500/30 text-amber-500"
                        : "border-border/80 text-muted-foreground"
                    }`}
                    role="status"
                  >
                    {draft.skillIds.length}/
                    {AGENT_ROSTER_LIMITS.maxSkillsPerAgent}
                  </span>
                </div>

                <SegmentControl<AgentSkillAssignmentMode>
                  label="Assignment mode"
                  onChange={(skillAssignment) =>
                    setDraft((current) => ({ ...current, skillAssignment }))
                  }
                  options={[
                    { value: "auto", label: "Auto route" },
                    { value: "manual", label: "Fixed bundle" },
                  ]}
                  value={draft.skillAssignment}
                />

                <div className="grid gap-1.5 sm:grid-cols-2">
                  {skillOptions.map((skill) => {
                    const checked = draft.skillIds.includes(skill.id);
                    const atLimit =
                      !checked &&
                      draft.skillIds.length >=
                        AGENT_ROSTER_LIMITS.maxSkillsPerAgent;
                    return (
                      <label
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                          checked
                            ? "border-foreground/20 bg-accent/45"
                            : "border-border/70 bg-card/[0.12]"
                        } ${atLimit ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-accent/25"}`}
                        key={skill.id}
                      >
                        <input
                          checked={checked}
                          className="mt-0.5 size-3.5 accent-primary"
                          disabled={atLimit}
                          onChange={() => toggleSkill(skill.id)}
                          type="checkbox"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-ui-caption font-medium text-foreground">
                              {skill.name}
                            </span>
                            {skill.source === "installed" ? (
                              <Check
                                aria-label="Installed"
                                className="size-3 shrink-0 text-emerald-500"
                              />
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                            {skill.id}
                          </span>
                          <span className="mt-0.5 block text-[9.5px] leading-4 text-muted-foreground">
                            {skill.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {draft.skillIds.length < minSkills ? (
                  <div
                    className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-ui-caption text-amber-600 dark:text-amber-300"
                    role="alert"
                  >
                    Select at least {minSkills} skills so the role has a
                    meaningful instruction pack.
                  </div>
                ) : null}
              </section>
            ) : null}

            {section === "review" ? (
              <section
                aria-labelledby="agent-review-heading"
                className="space-y-4"
              >
                <div>
                  <h3
                    id="agent-review-heading"
                    className="text-ui font-medium text-foreground"
                  >
                    Review and test
                  </h3>
                  <p className="mt-1 text-ui-label leading-5 text-muted-foreground">
                    This is what {draft.name || "the agent"} will actually be
                    able to do. Enforced settings cannot be exceeded at run
                    time; advisory ones shape the agent&rsquo;s instructions.
                  </p>
                </div>

                <EffectivePermissionsPanel profile={draft} />

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/70 px-3 py-2.5 text-ui-label">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Role</dt>
                    <dd className="truncate text-foreground">
                      {draft.roleName || "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Model</dt>
                    <dd className="truncate text-foreground">
                      {draft.model === "auto"
                        ? "Workspace default"
                        : (configuredBuildModel?.model ?? draft.model)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Skills</dt>
                    <dd className="text-foreground">
                      {draft.skillIds.length} selected
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Mention</dt>
                    <dd className="truncate text-foreground">
                      {draft.mention}
                    </dd>
                  </div>
                </dl>

                <div>
                  <label
                    htmlFor="agent-test-prompt"
                    className="block text-ui-label font-medium text-foreground"
                  >
                    Test prompt{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <p className="mt-0.5 text-ui-caption leading-4 text-muted-foreground">
                    Save and start a test chat with these settings. The test
                    uses your account credits.
                  </p>
                  <Textarea
                    id="agent-test-prompt"
                    value={testPrompt}
                    onChange={(event) => setTestPrompt(event.target.value)}
                    placeholder="e.g. List the open TODOs in this repository and summarize them."
                    className="mt-1.5 min-h-[72px] text-ui-label"
                  />
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center gap-y-2 border-t border-border/75 px-4 py-3 sm:px-5 sm:justify-between">
          <div className="hidden items-center gap-1.5 text-[9.5px] text-muted-foreground sm:flex">
            <ShieldCheck aria-hidden className="size-3" />
            Workspace permissions still apply.
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Button onClick={onClose} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            {!isFirstStep ? (
              <Button
                onClick={() => goToStep(-1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Back
              </Button>
            ) : null}
            {!isReviewStep ? (
              <Button
                className="gap-1.5"
                onClick={() => goToStep(1)}
                size="sm"
                type="button"
              >
                Next
                <ChevronRight aria-hidden className="size-3.5" />
              </Button>
            ) : (
              <>
                {onSaveAndTest ? (
                  <Button
                    disabled={!canSave || saving || !testPrompt.trim()}
                    onClick={() => void submit(testPrompt.trim())}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {saving ? "Saving…" : "Save & test"}
                  </Button>
                ) : null}
                <Button
                  className="gap-1.5"
                  disabled={!canSave || saving}
                  onClick={() => void submit()}
                  size="sm"
                  type="button"
                >
                  <Bot aria-hidden className="size-3.5" />
                  {saving
                    ? "Syncing…"
                    : initialProfile
                      ? "Save agent"
                      : "Create agent"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
