"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, Layers, LoaderCircle } from "lucide-react";
import { ExecutionTargetSelector } from "../ChatInput/ExecutionTargetSelector";

import { api } from "@/convex/_generated/api";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consumeProjectSelectorRequest } from "@/lib/utils/composer-controls";
import type { ActiveProjectContext } from "@/types/chat";

const NO_PROJECT = "__no_project__";

/** Cursor-style context strip backed by real project and run targets. */
export function HomeCommandCenter({
  chatId,
  openProjectOnMount = false,
  showProjectLockHint = false,
}: {
  chatId?: string;
  isGenerating?: boolean;
  openProjectOnMount?: boolean;
  showProjectLockHint?: boolean;
}) {
  const projects = useQuery(api.projects.listForUser, {});
  const chat = useQuery(
    api.chats.getChatByIdFromClient,
    chatId ? { id: chatId } : "skip",
  );
  const {
    activeProject,
    setActiveProject,
    sandboxPreference,
    setSandboxPreference,
    hasLocalSandbox,
    isSelectedSandboxAvailable,
    localExecutionTargets,
    defaultLocalSandboxPreference,
  } = useGlobalState();
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const buildProjects = useMemo(
    () => (projects ?? []).filter((project) => project.type === "app"),
    [projects],
  );
  const projectLocked = Boolean(
    chat?.project_id && (chat.project_bot_id || chat.bot_meeting_id),
  );
  const boundProject = projectLocked
    ? buildProjects.find((project) => project._id === chat?.project_id)
    : undefined;
  const projectLabel = projectLocked
    ? (boundProject?.name ?? "Project")
    : activeProject?.name?.trim() || "No project";

  useEffect(() => {
    if (
      !boundProject ||
      (activeProject?.id === boundProject._id &&
        activeProject.name === boundProject.name)
    )
      return;
    setActiveProject({
      id: boundProject._id,
      name: boundProject.name,
      type: boundProject.type,
    });
  }, [boundProject, activeProject?.id, activeProject?.name, setActiveProject]);

  useEffect(() => {
    const pending = consumeProjectSelectorRequest();
    if (!pending && !openProjectOnMount) return;
    const frame = window.requestAnimationFrame(() =>
      setProjectPickerOpen(true),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [openProjectOnMount]);

  const selectProject = (id: string) => {
    if (projectLocked) return;
    if (id === NO_PROJECT) {
      setActiveProject(null);
      return;
    }
    const project = buildProjects.find((candidate) => candidate._id === id);
    if (!project) return;
    const selection: ActiveProjectContext = {
      id: project._id,
      name: project.name,
      type: project.type,
    };
    setActiveProject(selection);
  };

  return (
    <section
      aria-label="New agent context"
      className="rift-composer-context order-0 flex min-h-9 w-full flex-wrap items-center gap-1.5 px-3 text-left text-ui-label text-muted-foreground"
      data-rift-home-command-center
    >
      <DropdownMenu
        open={!projectLocked && projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none"
            data-rift-composer-trigger
            aria-label={
              projectLocked
                ? `Project: ${projectLabel}`
                : "Select project context"
            }
            title={
              projectLocked
                ? "This conversation belongs to its project bot team."
                : undefined
            }
            disabled={projectLocked}
          >
            <Layers aria-hidden className="size-3" strokeWidth={1.6} />
            <span className="max-w-36 truncate">{projectLabel}</span>
            {!projectLocked && (
              <ChevronDown aria-hidden className="size-3" strokeWidth={1.6} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-rift-composer-menu="project"
          align="start"
          className="w-72"
        >
          <DropdownMenuLabel className="rift-menu-heading">
            Project context
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeProject?.id ?? NO_PROJECT}
            onValueChange={selectProject}
          >
            <DropdownMenuRadioItem value={NO_PROJECT} className="text-ui-nav">
              <span className="min-w-0 flex-1">
                <span className="rift-menu-label block">No project</span>
                <span className="rift-menu-description block">
                  Use the default RIFT workspace
                </span>
              </span>
            </DropdownMenuRadioItem>
            {buildProjects.map((project) => (
              <DropdownMenuRadioItem
                value={project._id}
                key={project._id}
                className="text-ui-nav"
              >
                <span className="min-w-0 flex-1">
                  <span className="rift-menu-label block truncate">
                    {project.name}
                  </span>
                  <span className="rift-menu-description block">
                    Isolated Build workspace
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {projects === undefined ? (
            <div
              className="flex items-center gap-2 px-2 py-2 text-ui-caption text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                aria-hidden
                className="size-3 motion-safe:animate-spin"
              />
              Loading projects
            </div>
          ) : null}
          <DropdownMenuSeparator />
          <div className="rift-menu-description px-2 py-1.5">
            Choose where this conversation belongs.
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <div>
        <ExecutionTargetSelector
          value={sandboxPreference ?? "e2b"}
          localTarget={defaultLocalSandboxPreference ?? null}
          hasLocalTarget={hasLocalSandbox}
          selectedLocalAvailable={isSelectedSandboxAvailable}
          localTargets={localExecutionTargets}
          onChange={setSandboxPreference}
        />
      </div>
      {projectLocked && showProjectLockHint && (
        <p className="w-full text-ui-caption text-muted-foreground">
          This bot uses its project workspace. Start a new chat to choose
          another project.
        </p>
      )}
    </section>
  );
}
