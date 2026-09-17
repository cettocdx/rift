"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observeChatViewport } from "@/app/components/chat-layout/ChatViewport";
import { useQuery } from "convex/react";
import {
  Bot,
  Hammer,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AGENT_PET_ROSTER,
  DEFAULT_AGENT_ROSTER_SELECTION,
  MANAGED_AGENT_ROSTER_SKILL_ID,
  builtinAgentMention,
  normalizeAgentRosterConfiguration,
  parseAgentRosterConfiguration,
} from "@/lib/ai/agents/pet-roster";

export type CreatableProjectType = "app" | "image";

const PROJECT_TYPES = [
  {
    id: "app",
    label: "Build",
    description: "Code, plan, test, and review with agents.",
    Icon: Hammer,
  },
  {
    id: "image",
    label: "Image",
    description: "Generate visual assets in Studio.",
    Icon: ImageIcon,
  },
] as const;

type NewProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    type: CreatableProjectType,
    agentMention?: string,
  ) => Promise<boolean>;
};

type AgentWorkflowChoice = {
  mention: string;
  label: string;
  description: string;
  kind: "adaptive" | "agent" | "team";
};

export function NewProjectDialog({
  open,
  onClose,
  onCreate,
}: NewProjectDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const attachDialog = useCallback((node: HTMLDivElement | null) => {
    if (node) return observeChatViewport(node);
  }, []);
  const [name, setName] = useState("");
  const [type, setType] = useState<CreatableProjectType>("app");
  const [agentMention, setAgentMention] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const installedSkills = useQuery(api.skills.listForUser, {});
  const managedRosterSkill = installedSkills?.find(
    (skill) => skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID,
  );
  const workflowChoices = useMemo<AgentWorkflowChoice[]>(() => {
    const configuration =
      parseAgentRosterConfiguration(managedRosterSkill?.instructions) ??
      normalizeAgentRosterConfiguration(DEFAULT_AGENT_ROSTER_SELECTION);
    const builtins = configuration.workflowAgentIds.flatMap((id) => {
      const agent = AGENT_PET_ROSTER.find((candidate) => candidate.id === id);
      return agent
        ? [
            {
              mention: builtinAgentMention(agent),
              label: `${agent.petName} · ${agent.roleName}`,
              description: agent.description,
              kind: "agent" as const,
            },
          ]
        : [];
    });
    const customAgents = configuration.customAgents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        mention: agent.mention,
        label: `${agent.name} · ${agent.roleName}`,
        description: agent.mission,
        kind: "agent" as const,
      }));
    const teams = configuration.teams
      .filter((team) => team.enabled)
      .map((team) => ({
        mention: team.mention,
        label: team.name,
        description: `${team.goal} · ${team.memberAgentIds.length} participants`,
        kind: "team" as const,
      }));
    return [
      {
        mention: "",
        label: "Adaptive crew",
        description:
          "RIFT picks the lead and specialists from your enabled crew for each task.",
        kind: "adaptive",
      },
      ...teams,
      ...builtins,
      ...customAgents,
    ];
  }, [managedRosterSkill?.instructions]);
  const selectedWorkflow =
    workflowChoices.find((choice) => choice.mention === agentMention) ??
    workflowChoices[0];

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("app");
    setAgentMention("");
    setSubmitting(false);
  }, [open]);

  const canSubmit = name.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const created = await onCreate(
        name.trim(),
        type,
        type === "app" && agentMention ? agentMention : undefined,
      );
      if (created) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        ref={attachDialog}
        style={{
          top: "calc(var(--rift-chat-viewport-offset, 0px) + var(--rift-chat-viewport-height, 100%) / 2)",
        }}
        className="max-h-[calc(var(--rift-chat-viewport-height,100dvh)-1rem)] max-w-[520px] gap-4 overflow-y-auto"
        onOpenAutoFocus={() => {
          openerRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current;
          if (
            opener?.isConnected &&
            !opener.matches(":disabled, [aria-disabled='true']")
          ) {
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-ui-section">New project</DialogTitle>
          <DialogDescription className="text-ui-nav leading-5">
            Create a named workspace. RIFT opens it immediately in the matching
            product surface.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="new-project-name">
            Project name
          </label>
          <Input
            className="h-9 text-ui"
            id="new-project-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="Project name"
            value={name}
          />

          <fieldset>
            <legend className="mb-1.5 text-ui-label font-medium text-muted-foreground">
              Workspace type
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {PROJECT_TYPES.map(({ id, label, description, Icon }) => {
                const active = type === id;
                return (
                  <button
                    aria-label={label}
                    aria-pressed={active}
                    className={`min-h-[76px] rounded-md border px-3 py-2.5 text-left transition-colors duration-(--duration-hover) focus-visible:outline-none ${
                      active
                        ? "border-foreground/25 bg-accent text-foreground"
                        : "border-border/80 bg-card/20 text-muted-foreground hover:bg-accent/55 hover:text-foreground"
                    }`}
                    key={id}
                    onClick={() => {
                      setType(id);
                      if (id !== "app") setAgentMention("");
                    }}
                    type="button"
                  >
                    <span className="flex items-center gap-2 text-ui-nav font-medium">
                      <Icon
                        aria-hidden
                        className="size-3.5"
                        strokeWidth={1.7}
                      />
                      {label}
                    </span>
                    <span className="mt-1 block text-ui-caption leading-4 text-muted-foreground">
                      {description}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {type === "app" ? (
            <fieldset>
              <legend className="mb-1.5 flex items-center gap-1.5 text-ui-label font-medium text-muted-foreground">
                <Sparkles aria-hidden className="size-3" />
                Agent workflow
              </legend>
              <div className="rounded-lg border border-border/80 bg-card/20 p-2.5">
                <label className="sr-only" htmlFor="new-project-agent-workflow">
                  Agent workflow
                </label>
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/45 text-muted-foreground">
                    {selectedWorkflow.kind === "team" ? (
                      <UsersRound aria-hidden className="size-4" />
                    ) : (
                      <Bot aria-hidden className="size-4" />
                    )}
                  </span>
                  <select
                    id="new-project-agent-workflow"
                    aria-label="Agent workflow"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-ui-nav text-foreground shadow-none outline-none"
                    onChange={(event) => setAgentMention(event.target.value)}
                    value={agentMention}
                  >
                    {workflowChoices.map((choice) => (
                      <option
                        key={choice.mention || "adaptive"}
                        value={choice.mention}
                      >
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 flex items-start justify-between gap-3 border-t border-border/70 pt-2">
                  <p className="text-ui-caption leading-4 text-muted-foreground">
                    {selectedWorkflow.description}
                  </p>
                  <span className="shrink-0 rounded-md border border-emerald-500/25 bg-emerald-500/8 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-700 dark:text-emerald-300">
                    Runs automatically
                  </span>
                </div>
              </div>
            </fieldset>
          ) : null}

          <div className="mt-1 flex justify-end gap-2">
            <Button
              className="h-8 gap-1.5 text-ui-nav"
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
              Cancel
            </Button>
            <Button
              className="h-8 gap-1.5 text-ui-nav"
              disabled={!canSubmit || submitting}
              onClick={() => void submit()}
              size="sm"
              type="button"
            >
              {submitting ? (
                <Loader2
                  aria-hidden
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Plus aria-hidden className="size-3.5" />
              )}
              {submitting ? "Creating…" : "Create project"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
