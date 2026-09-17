"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Bot,
  Copy,
  Download,
  FileJson,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { queueNewChatMessage } from "@/lib/utils/new-chat-message";
import { countInputTokens } from "@/lib/client-token-estimate";
import { getMessageTokenBudget } from "@/lib/token-limits";
import { toast } from "sonner";

import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputApi } from "@/app/contexts/InputContext";
import { useHorizontalTabs } from "@/app/hooks/useHorizontalTabs";
import {
  CodexEmptyState,
  CodexPageHeader,
  CodexPageShell,
  CodexSectionHeading,
} from "@/app/components/page-shell/CodexPageShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import {
  AGENT_PET_CATALOG,
  AGENT_PET_ROSTER,
  AGENT_ROSTER_LIMITS,
  AGENT_ROSTER_STORAGE_KEY,
  DEFAULT_AGENT_ROSTER_SELECTION,
  MANAGED_AGENT_ROSTER_SKILL_ID,
  getAgentPetCatalogDefinition,
  normalizeAgentRosterConfiguration,
  parseAgentRosterConfiguration,
  renderAgentRosterSkillInstructions,
  serializeAgentRosterConfiguration,
  type AgentPetCatalogId,
  type AgentRosterConfiguration,
  type AgentTeamConfig,
  type CustomAgentProfileConfig,
} from "@/lib/ai/agents/pet-roster";
import { cn } from "@/lib/utils";
import { AgentPetAvatar } from "./AgentPetAvatar";
import {
  AgentProfileDialog,
  type AgentAssignableMcpServer,
  type AgentAssignableSkill,
} from "./AgentProfileDialog";
import { AgentTeamDialog } from "./AgentTeamDialog";

type AgentsView = "roster" | "catalog" | "teams";

type PendingDelete =
  | { kind: "agent"; id: string; name: string }
  | { kind: "team"; id: string; name: string }
  | null;

type ProfileEditorState =
  | { initialPetId: AgentPetCatalogId; profile?: undefined }
  | { profile: CustomAgentProfileConfig; initialPetId?: undefined }
  | null;

const VIEW_OPTIONS: ReadonlyArray<{
  id: AgentsView;
  label: string;
  description: string;
}> = [
  // The roster tab lists the agents this workspace saved; the built-in crew
  // above the tabs is where the shipped participants live. Counting the
  // catalog here keeps the tab honest when an archetype is added or dropped.
  { id: "roster", label: "Roster", description: "Agents you saved" },
  {
    id: "catalog",
    label: "Catalog",
    description: `${AGENT_PET_CATALOG.length} pet archetypes`,
  },
  { id: "teams", label: "Teams", description: "Orchestration groups" },
];

function cloneDefaultConfiguration(): AgentRosterConfiguration {
  return normalizeAgentRosterConfiguration(DEFAULT_AGENT_ROSTER_SELECTION);
}

function readLocalConfiguration(): AgentRosterConfiguration | null {
  try {
    const value = window.localStorage.getItem(AGENT_ROSTER_STORAGE_KEY);
    return value ? normalizeAgentRosterConfiguration(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

function writeLocalConfiguration(configuration: AgentRosterConfiguration) {
  try {
    window.localStorage.setItem(
      AGENT_ROSTER_STORAGE_KEY,
      serializeAgentRosterConfiguration(configuration),
    );
  } catch {
    // The managed Convex skill remains authoritative when storage is blocked.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The agent roster could not be synced.";
}

function isRosterExport(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.version === 1 || candidate.version === 2) &&
    typeof candidate.activeAgentId === "string" &&
    Array.isArray(candidate.workflowAgentIds)
  );
}

function participantLabel(id: string, configuration: AgentRosterConfiguration) {
  const builtin = AGENT_PET_ROSTER.find((agent) => agent.id === id);
  if (builtin) return builtin.petName;
  return (
    configuration.customAgents.find((agent) => agent.id === id)?.name ?? id
  );
}

function focusComposer() {
  requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>(
      '[data-ui="composer-textarea"] textarea',
    );
    composer?.focus();
    composer?.setSelectionRange(composer.value.length, composer.value.length);
  });
}

/**
 * Only the exception carries a badge. The switch at the other end of the same
 * row already states that an agent is on, and "Runtime ready" means something
 * else everywhere else in the product — in the crew panel it reports that the
 * managed skill reached the runtime, not that a local toggle is checked.
 */
function PausedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/35 px-1.5 py-0.5 text-ui-caption font-medium text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-muted-foreground/55"
      />
      Paused
    </span>
  );
}

export function AgentsWorkbench() {
  const router = useRouter();
  const { initializeNewChat, subscription, hasPaidContext } = useGlobalState();
  const { setInput } = useInputApi();
  const installedSkills = useQuery(api.skills.listForUser, {});
  const mcpServers = useQuery(api.mcpServers.listForUser, {});
  const syncAgentRoster = useMutation(api.skills.syncAgentRoster);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const didHydrate = useRef(false);
  const didOpenDeepLink = useRef(false);

  const [configuration, setConfiguration] = useState<AgentRosterConfiguration>(
    cloneDefaultConfiguration,
  );
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  // The catalog, not the roster. Arriving on an empty list of "active
  // participants" shows nothing and offers nothing; the catalog is what the
  // page is for on a first visit.
  const [view, setView] = useState<AgentsView>("catalog");
  const viewTabs = useHorizontalTabs(
    VIEW_OPTIONS.map((option) => option.id),
    view,
    setView,
  );
  const [query, setQuery] = useState("");
  const [profileEditor, setProfileEditor] = useState<ProfileEditorState>(null);
  const [teamEditor, setTeamEditor] = useState<AgentTeamConfig | "new" | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [pendingImport, setPendingImport] =
    useState<AgentRosterConfiguration | null>(null);

  const managedRosterSkill = installedSkills?.find(
    (skill) => skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID,
  );

  useEffect(() => {
    if (didHydrate.current || installedSkills === undefined) return;
    didHydrate.current = true;
    const runtimeConfiguration = parseAgentRosterConfiguration(
      managedRosterSkill?.instructions,
    );
    setConfiguration(
      runtimeConfiguration ??
        readLocalConfiguration() ??
        cloneDefaultConfiguration(),
    );
    setHydrated(true);
  }, [installedSkills, managedRosterSkill]);

  useEffect(() => {
    if (!hydrated || didOpenDeepLink.current) return;
    const create = new URLSearchParams(window.location.search).get("create");
    if (create !== "agent" && create !== "team") return;
    didOpenDeepLink.current = true;
    if (create === "team") {
      if (configuration.teams.length < AGENT_ROSTER_LIMITS.teams) {
        setTeamEditor("new");
      }
    } else if (
      configuration.customAgents.length < AGENT_ROSTER_LIMITS.customAgents
    ) {
      setProfileEditor({ initialPetId: "dog" });
    }
    window.history.replaceState(window.history.state, "", "/agents");
  }, [configuration, hydrated]);

  const assignableSkills = useMemo<AgentAssignableSkill[]>(() => {
    return (installedSkills ?? [])
      .filter((skill) => skill.catalog_id !== MANAGED_AGENT_ROSTER_SKILL_ID)
      .map((skill) => ({
        id: skill.catalog_id ?? String(skill._id),
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        source: "installed" as const,
      }))
      .sort((left, right) => {
        const enabledDelta = Number(right.enabled) - Number(left.enabled);
        return enabledDelta || left.name.localeCompare(right.name);
      });
  }, [installedSkills]);

  const assignableMcpServers = useMemo<AgentAssignableMcpServer[]>(
    () =>
      (mcpServers ?? []).map((server) => ({
        id: String(server._id),
        name: server.name,
        enabled: server.enabled,
        connectionStatus: server.connectionStatus,
      })),
    [mcpServers],
  );

  const visibleCatalog = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return AGENT_PET_CATALOG;
    return AGENT_PET_CATALOG.filter((pet) =>
      [pet.speciesLabel, pet.petName, pet.roleName, pet.description].some(
        (value) => value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [query]);

  const persistConfiguration = async (
    nextValue: AgentRosterConfiguration,
    successMessage: string,
  ) => {
    const next = normalizeAgentRosterConfiguration(nextValue);
    setSaving(true);
    try {
      const instructions = renderAgentRosterSkillInstructions(next);
      const activeAgent = AGENT_PET_ROSTER.find(
        (agent) => agent.id === next.activeAgentId,
      )!;
      const customCount = next.customAgents.filter(
        (agent) => agent.enabled,
      ).length;
      const teamCount = next.teams.filter((team) => team.enabled).length;
      const result = await syncAgentRoster({
        description: `${activeAgent.petName} is the default lead. ${customCount} custom agents and ${teamCount} teams are enabled.`,
        instructions,
      });
      if (!result.success) {
        throw new Error(
          result.error ?? "The agent roster could not be synced.",
        );
      }
      setConfiguration(next);
      writeLocalConfiguration(next);
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const invokeMention = (mention: string) => {
    initializeNewChat("app");
    router.push("/");
    requestAnimationFrame(() => {
      setInput(`${mention} `);
      focusComposer();
    });
  };

  const saveProfile = async (profile: CustomAgentProfileConfig) => {
    const existingIndex = profileEditor?.profile
      ? configuration.customAgents.findIndex(
          (candidate) => candidate.id === profileEditor.profile?.id,
        )
      : -1;
    const customAgents = [...configuration.customAgents];
    if (existingIndex >= 0) customAgents[existingIndex] = profile;
    else customAgents.push(profile);
    const saved = await persistConfiguration(
      { ...configuration, customAgents },
      existingIndex >= 0 ? "Agent updated" : "Agent added to the runtime",
    );
    if (saved) {
      setProfileEditor(null);
      setView("roster");
    }
    return saved;
  };

  const saveProfileAndTest = async (
    profile: CustomAgentProfileConfig,
    testPrompt: string,
  ) => {
    const message = `${profile.mention} ${testPrompt}`.trim();
    const tokenCount = countInputTokens(message);
    const maxTokens = getMessageTokenBudget(subscription, {
      mode: "agent",
      model: profile.model,
      hasPaidContext,
      purpose: "app",
    });
    if (tokenCount > maxTokens) {
      toast.error("Test prompt is too long", {
        description: `Please shorten the test prompt (${tokenCount.toLocaleString()}/${maxTokens.toLocaleString()} tokens) before saving and testing.`,
      });
      return;
    }
    const saved = await saveProfile(profile);
    if (!saved) return;
    // Open a scratch Build chat that runs the prompt as this agent, so a person
    // can try the configuration under exactly its effective access before
    // relying on it. The destination consumes the intent only after its fresh
    // chat identity and normal submit handler are ready.
    initializeNewChat("app");
    router.push(queueNewChatMessage(message));
  };

  const saveTeam = async (team: AgentTeamConfig) => {
    const existingIndex =
      teamEditor !== "new" && teamEditor
        ? configuration.teams.findIndex(
            (candidate) => candidate.id === teamEditor.id,
          )
        : -1;
    const teams = [...configuration.teams];
    if (existingIndex >= 0) teams[existingIndex] = team;
    else teams.push(team);
    const saved = await persistConfiguration(
      { ...configuration, teams },
      existingIndex >= 0 ? "Team updated" : "Team added to the runtime",
    );
    if (saved) {
      setTeamEditor(null);
      setView("teams");
    }
  };

  const duplicateAgent = async (profile: CustomAgentProfileConfig) => {
    if (configuration.customAgents.length >= AGENT_ROSTER_LIMITS.customAgents)
      return;
    await persistConfiguration(
      {
        ...configuration,
        customAgents: [
          ...configuration.customAgents,
          { ...profile, id: "", mention: "", name: `${profile.name} Copy` },
        ],
      },
      "Agent duplicated",
    );
  };

  const duplicateTeam = async (team: AgentTeamConfig) => {
    if (configuration.teams.length >= AGENT_ROSTER_LIMITS.teams) return;
    await persistConfiguration(
      {
        ...configuration,
        teams: [
          ...configuration.teams,
          { ...team, id: "", mention: "", name: `${team.name} Copy` },
        ],
      },
      "Team duplicated",
    );
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const next =
      pendingDelete.kind === "agent"
        ? {
            ...configuration,
            customAgents: configuration.customAgents.filter(
              (agent) => agent.id !== pendingDelete.id,
            ),
          }
        : {
            ...configuration,
            teams: configuration.teams.filter(
              (team) => team.id !== pendingDelete.id,
            ),
          };
    const saved = await persistConfiguration(
      next,
      `${pendingDelete.name} deleted`,
    );
    if (saved) setPendingDelete(null);
  };

  const exportConfiguration = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          normalizeAgentRosterConfiguration(configuration),
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rift-agent-roster.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readImport = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 64 * 1024) {
      toast.error("Agent roster files must be 64 KB or smaller.");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRosterExport(parsed)) {
        throw new Error("invalid roster shape");
      }
      setPendingImport(normalizeAgentRosterConfiguration(parsed));
    } catch {
      toast.error("That file is not valid RIFT agent-roster JSON.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!hydrated) {
    return (
      <CodexPageShell busy>
        <div className="flex min-h-72 items-center justify-center text-ui-label text-muted-foreground">
          <Loader2
            aria-hidden
            className="mr-2 size-4 animate-spin motion-reduce:animate-none"
          />
          Loading the runtime roster…
        </div>
      </CodexPageShell>
    );
  }

  const atAgentLimit =
    configuration.customAgents.length >= AGENT_ROSTER_LIMITS.customAgents;
  const atTeamLimit = configuration.teams.length >= AGENT_ROSTER_LIMITS.teams;
  const activeLead = AGENT_PET_ROSTER.find(
    (agent) => agent.id === configuration.activeAgentId,
  )!;

  return (
    <CodexPageShell busy={saving}>
      <CodexPageHeader
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <input
              accept="application/json,.json"
              aria-label="Import agent roster"
              className="sr-only"
              onChange={(event) => void readImport(event.target.files?.[0])}
              ref={fileInputRef}
              type="file"
            />
            <Button
              aria-label="Import roster"
              className="h-8 gap-1.5 px-2.5 text-ui-caption"
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Upload aria-hidden className="size-3.5" />
              Import
            </Button>
            <Button
              className="h-8 gap-1.5 px-2.5 text-ui-caption"
              onClick={exportConfiguration}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Download aria-hidden className="size-3.5" />
              Export
            </Button>
            <Button
              className="h-8 gap-1.5 text-ui-caption"
              disabled={atTeamLimit || saving}
              onClick={() => setTeamEditor("new")}
              size="sm"
              type="button"
              variant="outline"
            >
              <UsersRound aria-hidden className="size-3.5" />
              New team
            </Button>
            <Button
              className="h-8 gap-1.5 text-ui-caption"
              disabled={atAgentLimit || saving}
              onClick={() => setProfileEditor({ initialPetId: "dog" })}
              size="sm"
              type="button"
            >
              <Plus aria-hidden className="size-3.5" />
              New agent
            </Button>
          </div>
        }
        description="Set up specialist agents and teams. Mention an agent in Build to use its skills and settings."
        title="Agents"
      />

      <section aria-labelledby="crew-habitat-heading" className="mb-5">
        <CodexSectionHeading
          meta={`${configuration.workflowAgentIds.length} available · ${activeLead.petName} leads`}
        >
          <span id="crew-habitat-heading">Built-in crew habitat</span>
        </CodexSectionHeading>
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-background dark:divide-[#303030] dark:border-[#303030] dark:bg-background">
          {AGENT_PET_ROSTER.map((agent) => {
            const active = configuration.activeAgentId === agent.id;
            const participating = configuration.workflowAgentIds.includes(
              agent.id,
            );
            return (
              <article
                className={cn(
                  "flex min-h-[58px] min-w-0 items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/25",
                  active && "bg-accent/25",
                )}
                key={agent.id}
              >
                <AgentPetAvatar
                  accent={agent.accent}
                  agentName={agent.petName}
                  participating={participating}
                  role={agent.id}
                  roleName={agent.roleName}
                  selected={active}
                  size={34}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui font-medium text-foreground">
                    {agent.petName}
                  </div>
                  <div className="mt-0.5 truncate text-ui-caption text-muted-foreground">
                    {agent.roleName}
                    {active
                      ? " · Default lead"
                      : participating
                        ? " · Available"
                        : " · Paused"}
                  </div>
                </div>
                <Switch
                  aria-label={`${participating ? "Pause" : "Enable"} ${agent.petName}`}
                  checked={participating}
                  disabled={active || saving}
                  onCheckedChange={(checked) =>
                    void persistConfiguration(
                      {
                        ...configuration,
                        workflowAgentIds: checked
                          ? [...configuration.workflowAgentIds, agent.id]
                          : configuration.workflowAgentIds.filter(
                              (id) => id !== agent.id,
                            ),
                      },
                      `${agent.petName} ${checked ? "enabled" : "paused"}`,
                    )
                  }
                />
                {/* The lead's row leaves this slot empty: the line beside the
                    name already reads "Default lead". The slot keeps its width
                    so every switch stays in one column. */}
                <div className="flex min-w-20 shrink-0 justify-end">
                  {active ? null : (
                    <button
                      className="h-7 rounded-md px-2.5 text-ui-caption font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
                      disabled={saving}
                      onClick={() =>
                        void persistConfiguration(
                          {
                            ...configuration,
                            activeAgentId: agent.id,
                            workflowAgentIds:
                              configuration.workflowAgentIds.includes(agent.id)
                                ? configuration.workflowAgentIds
                                : [...configuration.workflowAgentIds, agent.id],
                          },
                          `${agent.petName} is now the default lead`,
                        )
                      }
                      type="button"
                    >
                      Make lead
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div
        aria-label="Agent views"
        className="mb-5 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border/75 bg-card/[0.12] p-0.5 dark:border-[#303030] dark:bg-background"
        role="tablist"
      >
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.id}
            {...viewTabs.getTabProps(option.id)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/60",
              view === option.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/45 hover:text-foreground",
            )}
            type="button"
          >
            <span className="text-ui-label font-medium">{option.label}</span>
            <span className="sr-only">{option.description}</span>
          </button>
        ))}
      </div>

      {view === "roster" ? (
        <section
          {...viewTabs.getPanelProps("roster")}
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60"
        >
          <CodexSectionHeading
            meta={`${configuration.customAgents.length}/${AGENT_ROSTER_LIMITS.customAgents}`}
          >
            <span id="custom-roster-heading">Custom roster</span>
          </CodexSectionHeading>
          {configuration.customAgents.length === 0 ? (
            <CodexEmptyState
              action={
                <Button
                  className="h-8 gap-1.5 text-ui-caption"
                  onClick={() => setView("catalog")}
                  size="sm"
                  type="button"
                >
                  <Search aria-hidden className="size-3.5" />
                  Browse pet catalog
                </Button>
              }
              className="min-h-52"
              description="Start from a professional pet archetype, then set its model, skills, tools, permissions, memory, and workspace scope."
              icon={<Bot aria-hidden className="size-4" />}
              title="No custom agents yet"
            />
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-background dark:divide-[#303030] dark:border-[#303030] dark:bg-background">
              {configuration.customAgents.map((profile) => {
                const pet = getAgentPetCatalogDefinition(profile.petId);
                return (
                  <article
                    className="px-3.5 py-3 transition-colors hover:bg-accent/25"
                    key={profile.id}
                  >
                    <div className="flex items-start gap-3">
                      <AgentPetAvatar
                        accent={pet.accent}
                        agentName={profile.name}
                        label={`${pet.speciesLabel} agent`}
                        participating={profile.enabled}
                        role={pet.visualPreset}
                        roleName={profile.roleName}
                        selected={false}
                        size={42}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="truncate text-ui-label font-medium">
                            {profile.name}
                          </h3>
                          {profile.enabled ? null : <PausedBadge />}
                        </div>
                        <div className="mt-0.5 truncate text-ui-caption text-muted-foreground">
                          {profile.roleName} · {pet.speciesLabel}
                        </div>
                        <code className="mt-1 block truncate text-ui-caption text-muted-foreground">
                          {profile.mention}
                        </code>
                      </div>
                      <Switch
                        aria-label={`${profile.enabled ? "Pause" : "Enable"} ${profile.name}`}
                        checked={profile.enabled}
                        disabled={saving}
                        onCheckedChange={(enabled) =>
                          void persistConfiguration(
                            {
                              ...configuration,
                              customAgents: configuration.customAgents.map(
                                (agent) =>
                                  agent.id === profile.id
                                    ? { ...agent, enabled }
                                    : agent,
                              ),
                            },
                            `${profile.name} ${enabled ? "enabled" : "paused"}`,
                          )
                        }
                      />
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-8 text-ui-caption leading-4 text-muted-foreground">
                      {profile.mission}
                    </p>
                    <p className="mt-1.5 text-ui-caption text-muted-foreground">
                      {profile.model === "auto"
                        ? "Default model"
                        : profile.model}
                      {` · ${profile.skillIds.length} skills · ${profile.permissionPreset} access`}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1">
                      <Button
                        className="h-7 gap-1 px-2 text-ui-caption"
                        disabled={!profile.enabled}
                        onClick={() => invokeMention(profile.mention)}
                        size="sm"
                        type="button"
                      >
                        <Play aria-hidden className="size-3" />
                        Invoke in Build
                      </Button>
                      <Button
                        aria-label={`Edit ${profile.name}`}
                        className="size-7 p-0"
                        onClick={() => setProfileEditor({ profile })}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil aria-hidden className="size-3" />
                      </Button>
                      <Button
                        aria-label={`Duplicate ${profile.name}`}
                        className="size-7 p-0"
                        disabled={atAgentLimit || saving}
                        onClick={() => void duplicateAgent(profile)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Copy aria-hidden className="size-3" />
                      </Button>
                      <Button
                        aria-label={`Delete ${profile.name}`}
                        className="ml-auto size-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setPendingDelete({
                            kind: "agent",
                            id: profile.id,
                            name: profile.name,
                          })
                        }
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden className="size-3" />
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {atAgentLimit ? (
            <p
              className="mt-2 text-ui-caption text-muted-foreground"
              role="status"
            >
              Custom roster limit reached. Delete an agent before adding
              another.
            </p>
          ) : null}
          {/* Explaining why runs are not summarised only means something once
              there is a saved agent for a run to be attributed to; beneath the
              empty state it would read as a second "nothing here yet". */}
          {configuration.customAgents.length > 0 ? (
            <div className="mt-3 px-1 text-ui-caption leading-4 text-muted-foreground">
              Activity, cost, and completion metrics appear only when a run is
              attributable to a saved agent. No attributed runtime history is
              available on this roster yet.
            </div>
          ) : null}
        </section>
      ) : null}

      {view === "catalog" ? (
        <section
          {...viewTabs.getPanelProps("catalog")}
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-ui font-medium" id="pet-catalog-heading">
                Professional pet catalog
              </h2>
              <p className="mt-0.5 text-ui-caption text-muted-foreground">
                Choose a role to customize its skills, tools, and working style.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search pet catalog"
                className="h-8 pl-8 text-ui-caption"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search role or pet…"
                value={query}
              />
            </div>
          </div>
          {/* Every tile below goes disabled at the limit, so the reason has to
              stand on this tab too: the Roster tab, which carries the same
              notice, is not where you are when the catalog stops responding. */}
          {atAgentLimit ? (
            <p
              className="mb-2 rounded-md border border-border/80 bg-card/[0.12] px-3 py-2 text-ui-caption leading-4 text-muted-foreground dark:border-[#303030]"
              role="status"
            >
              Custom roster limit reached ({AGENT_ROSTER_LIMITS.customAgents}{" "}
              agents). Delete one under Roster before adding another.
            </p>
          ) : null}
          {/* Two across. The catalog is long enough that one tile per row is a
              scroll rather than a catalog — you cannot compare archetypes
              without losing your place. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visibleCatalog.map((pet) => (
              <button
                className="group flex min-h-[64px] min-w-0 items-start gap-3 rounded-lg border border-border/80 bg-background px-3.5 py-2.5 text-left transition-colors duration-(--duration-press) hover:border-foreground/25 hover:bg-accent/25 active:bg-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 dark:border-[#303030]"
                disabled={atAgentLimit}
                key={pet.id}
                onClick={() => setProfileEditor({ initialPetId: pet.id })}
                type="button"
              >
                <AgentPetAvatar
                  accent={pet.accent}
                  agentName={pet.petName}
                  label={`${pet.speciesLabel} template`}
                  participating
                  role={pet.visualPreset}
                  roleName={pet.roleName}
                  selected={false}
                  size={38}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-ui-label font-medium">
                      {pet.speciesLabel}
                    </span>
                    <Plus
                      aria-hidden
                      className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-ui-caption text-foreground/80">
                    {pet.petName} · {pet.roleName}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-ui-caption leading-4 text-muted-foreground">
                    {pet.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {visibleCatalog.length === 0 ? (
            <CodexEmptyState
              className="mt-2 min-h-44"
              description="Try a pet species, discipline, or professional role."
              icon={<Search aria-hidden className="size-4" />}
              title="No matching archetype"
            />
          ) : null}
        </section>
      ) : null}

      {view === "teams" ? (
        <section
          {...viewTabs.getPanelProps("teams")}
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60"
        >
          <CodexSectionHeading
            meta={`${configuration.teams.length}/${AGENT_ROSTER_LIMITS.teams}`}
          >
            <span id="agent-teams-heading">Agent teams</span>
          </CodexSectionHeading>
          {configuration.teams.length === 0 ? (
            <CodexEmptyState
              action={
                <Button
                  className="h-8 gap-1.5 text-ui-caption"
                  disabled={atTeamLimit}
                  onClick={() => setTeamEditor("new")}
                  size="sm"
                  type="button"
                >
                  <UsersRound aria-hidden className="size-3.5" />
                  Create team
                </Button>
              }
              className="min-h-52"
              description="Group enabled participants under one exact mention, with a real lead, routing policy, handoff, reviewer, and completion criteria."
              icon={<UsersRound aria-hidden className="size-4" />}
              title="No teams configured"
            />
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-background dark:divide-[#303030] dark:border-[#303030] dark:bg-background">
              {configuration.teams.map((team) => (
                <article
                  className="px-3.5 py-3 transition-colors hover:bg-accent/25"
                  key={team.id}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background/50 text-muted-foreground">
                      <UsersRound aria-hidden className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="truncate text-ui-label font-medium">
                          {team.name}
                        </h3>
                        {team.enabled ? null : <PausedBadge />}
                      </div>
                      <code className="mt-1 block truncate text-ui-caption text-muted-foreground">
                        {team.mention}
                      </code>
                    </div>
                    <Switch
                      aria-label={`${team.enabled ? "Pause" : "Enable"} ${team.name}`}
                      checked={team.enabled}
                      disabled={saving}
                      onCheckedChange={(enabled) =>
                        void persistConfiguration(
                          {
                            ...configuration,
                            teams: configuration.teams.map((candidate) =>
                              candidate.id === team.id
                                ? { ...candidate, enabled }
                                : candidate,
                            ),
                          },
                          `${team.name} ${enabled ? "enabled" : "paused"}`,
                        )
                      }
                    />
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-8 text-ui-caption leading-4 text-muted-foreground">
                    {team.goal}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border/70 bg-background/35 px-2.5 py-2 text-ui-caption">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Lead</dt>
                      <dd className="truncate text-foreground">
                        {participantLabel(team.leadAgentId, configuration)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Members</dt>
                      <dd className="truncate text-foreground">
                        {team.memberAgentIds.length}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Routing</dt>
                      <dd className="truncate text-foreground">
                        {team.routing}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Handoff</dt>
                      <dd className="truncate text-foreground">
                        {team.handoff}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    <Button
                      className="h-7 gap-1 px-2 text-ui-caption"
                      disabled={!team.enabled}
                      onClick={() => invokeMention(team.mention)}
                      size="sm"
                      type="button"
                    >
                      <Play aria-hidden className="size-3" />
                      Invoke in Build
                    </Button>
                    <Button
                      aria-label={`Edit ${team.name}`}
                      className="size-7 p-0"
                      onClick={() => setTeamEditor(team)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil aria-hidden className="size-3" />
                    </Button>
                    <Button
                      aria-label={`Duplicate ${team.name}`}
                      className="size-7 p-0"
                      disabled={atTeamLimit || saving}
                      onClick={() => void duplicateTeam(team)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Copy aria-hidden className="size-3" />
                    </Button>
                    <Button
                      aria-label={`Delete ${team.name}`}
                      className="ml-auto size-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setPendingDelete({
                          kind: "team",
                          id: team.id,
                          name: team.name,
                        })
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden className="size-3" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {atTeamLimit ? (
            <p
              className="mt-2 text-ui-caption text-muted-foreground"
              role="status"
            >
              Team limit reached. Delete a team before adding another.
            </p>
          ) : null}
        </section>
      ) : null}

      {profileEditor ? (
        <AgentProfileDialog
          initialPetId={profileEditor.initialPetId}
          initialProfile={profileEditor.profile}
          installedSkills={assignableSkills}
          mcpServers={assignableMcpServers}
          onClose={() => setProfileEditor(null)}
          onSave={async (profile) => {
            await saveProfile(profile);
          }}
          onSaveAndTest={saveProfileAndTest}
          open
          saving={saving}
        />
      ) : null}

      {teamEditor ? (
        <AgentTeamDialog
          configuration={configuration}
          initialTeam={teamEditor === "new" ? undefined : teamEditor}
          installedSkills={assignableSkills}
          onClose={() => setTeamEditor(null)}
          onSave={saveTeam}
          open
          saving={saving}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => !open && setPendingDelete(null)}
        open={Boolean(pendingDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved runtime profile. Teams that reference it
              will be repaired to use remaining enabled participants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => !open && setPendingImport(null)}
        open={Boolean(pendingImport)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the runtime roster?</AlertDialogTitle>
            <AlertDialogDescription>
              The imported file contains{" "}
              {pendingImport?.customAgents.length ?? 0} custom agents and{" "}
              {pendingImport?.teams.length ?? 0} teams. The current roster will
              be replaced after validation and synced to Build.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingImport) return;
                void persistConfiguration(
                  pendingImport,
                  "Agent roster imported",
                ).then((saved) => saved && setPendingImport(null));
              }}
            >
              <FileJson aria-hidden className="mr-1.5 size-3.5" />
              {saving ? "Importing…" : "Replace roster"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CodexPageShell>
  );
}
