"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { ChevronDown, ListFilter, Plus, Trash2, Loader2 } from "lucide-react";
import {
  HackIcon as Crosshair,
  BuildIcon as Blocks,
  StudioIcon as Images,
  FolderIcon as Folder,
  AgentsIcon as Bot,
} from "@/lib/ui/workspace-icons";
import type { ActiveProjectContext, ChatPurpose } from "@/types/chat";
import type { Id } from "@/convex/_generated/dataModel";
import {
  sidebarNavRowClass,
  SIDEBAR_SECTION_LABEL_CLASS,
} from "./SidebarHeader";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import {
  SidebarConversation,
  type SidebarConversationRecord,
} from "./SidebarConversation";
import SidebarHistory from "./SidebarHistory";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { NewProjectDialog } from "@/app/components/projects/NewProjectDialog";
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

type ProjectType = "security" | "app" | "image";

const TYPE_META: Record<
  ProjectType,
  { label: string; Icon: typeof Blocks; color: string }
> = {
  // Same glyphs as the nav rows for the same destinations. A project typed
  // "Build" wore a hammer while the Build row above it wore blocks, and the
  // security type wore the terminal glyph the window strip spends on the
  // actual terminal -- two vocabularies for one set of nouns.
  security: {
    label: "Hack Workbench",
    Icon: Crosshair,
    color: "text-[var(--cursor-icon-secondary)]",
  },
  app: {
    label: "Build",
    Icon: Blocks,
    color: "text-[var(--cursor-icon-secondary)]",
  },
  image: {
    label: "Studio",
    Icon: Images,
    color: "text-[var(--cursor-icon-secondary)]",
  },
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * "Projects" sidebar section — named workspaces of a chosen type. A self-
 * contained section: create a Build or Image project, see the list, and click
 * one to start work in that mode. Legacy Security projects are preserved but
 * open the single dedicated Hack Workbench instead of a retired chat mode.
 */
export function SidebarProjects({
  chats = [],
  paginationStatus,
  loadMore,
}: {
  chats?: SidebarConversationRecord[];
  paginationStatus?:
    | "LoadingFirstPage"
    | "CanLoadMore"
    | "LoadingMore"
    | "Exhausted";
  loadMore?: (count: number) => void;
}) {
  const router = useRouter();
  const projects = useQuery(api.projects.listForUser, {});
  const createProject = useMutation(api.projects.createProject);
  const removeProject = useMutation(api.projects.removeProject);

  const { goPurpose } = useChatNavigation();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const isMobile = useIsMobile();
  const {
    initializeNewChat,
    closeSidebar,
    setChatSidebarOpen,
    setTemporaryChatsEnabled,
    setActiveProject,
  } = useGlobalState();

  // Open a project = start a fresh chat in its mode (mirrors the sidebar's
  // launchMode). Kept internal so this section can render anywhere.
  const openProject = (project: {
    _id: Id<"projects">;
    name: string;
    type: ChatPurpose;
  }) => {
    closeSidebar();
    if (isMobile) setChatSidebarOpen(false);
    if (project.type === "security") {
      setTemporaryChatsEnabled(false);
      router.push("/hack");
      return;
    }
    const selection: ActiveProjectContext = {
      id: project._id,
      type: project.type,
      name: project.name,
    };
    const recent = chats.find((chat) => chat.project_id === project._id);
    if (recent) {
      setActiveProject(selection);
      goPurpose(project.type, recent.id);
    } else {
      initializeNewChat(project.type, selection);
      setTemporaryChatsEnabled(false);
      goPurpose(project.type);
    }
  };

  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("all");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const filterLabels = {
    all: "All chats",
    running: "Running",
    attention: "Needs attention",
    draft: "Drafts",
  };
  const visibleChats = chats.filter(
    (chat) =>
      filter === "all" ||
      (filter === "attention"
        ? ["waiting", "failed", "warning", "disconnected"].includes(
            chat.sidebarStatus ?? "",
          )
        : chat.sidebarStatus === filter),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleRemove = async (id: string, name: string) => {
    setBusyId(id);
    try {
      await removeProject({ id: id as never });
      toast.success(`Removed ${name}`);
      setPendingRemoval(null);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove"));
    } finally {
      setBusyId(null);
    }
  };

  const list = projects ?? [];

  return (
    <div
      data-pro-sidebar-projects
      className="border-b border-sidebar-border px-1.5 py-1"
    >
      {/* Section header — shared canonical section-label style, on the rail's
          one 6px inset (see the SidebarHeader wrapper note in Sidebar.tsx) and
          at the same 32px as every other row in the rail. */}
      <div className="flex h-8 items-center justify-between px-1.5">
        {/* Label first, chevron after — the same order Recent runs, and the
            order the reference runs: the name on the left edge, the control on
            the right. A leading chevron here pushed "Projects" 15px right of
            "Recent", so the rail's two section labels did not share a left
            edge with each other or with anything else in the column. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex h-full flex-1 items-center justify-between gap-1 rounded-[6px] focus-visible:outline-none focus-visible:bg-sidebar-accent ${SIDEBAR_SECTION_LABEL_CLASS}`}
        >
          Projects
          <ChevronDown
            className={`size-[11px] transition-transform ${open ? "" : "-rotate-90"}`}
            strokeWidth={1.75}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Filter conversations: ${filterLabels[filter as keyof typeof filterLabels]}`}
              title="Filter conversations"
              className={`ml-1 grid size-6 place-items-center rounded-md hover:bg-sidebar-accent ${filter !== "all" ? "text-foreground bg-sidebar-accent" : "text-muted-foreground"}`}
            >
              <ListFilter aria-hidden className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Recent conversations</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter} onValueChange={setFilter}>
              {Object.entries(filterLabels).map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          aria-label="New project"
          title="New project"
          className="ml-1 flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--cursor-icon-secondary)] transition-[background-color,color,transform] duration-(--duration-press) ease-(--ease-out) active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
        >
          <Plus className="size-3" />
        </button>
      </div>

      {open && (
        <div className="space-y-px pt-px">
          {list.length === 0 ? (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={sidebarNavRowClass(false)}
            >
              <Folder />
              New project
            </button>
          ) : (
            list.map((p) => {
              const meta = TYPE_META[p.type];
              const Icon = meta.Icon;
              const children = visibleChats.filter(
                (chat) => chat.project_id === p._id,
              );
              const expanded = expandedProjects.has(p._id);
              return (
                <div key={p._id}>
                  <div className={`group ${sidebarNavRowClass(false)}`}>
                    {children.length ? (
                      <button
                        type="button"
                        aria-label={`${collapsedProjects.has(p._id) ? "Expand" : "Collapse"} ${p.name}`}
                        aria-expanded={!collapsedProjects.has(p._id)}
                        className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent"
                        onClick={() =>
                          setCollapsedProjects((previous) => {
                            const next = new Set(previous);
                            if (next.has(p._id)) next.delete(p._id);
                            else next.add(p._id);
                            return next;
                          })
                        }
                      >
                        <ChevronDown
                          aria-hidden
                          className={`size-3 ${collapsedProjects.has(p._id) ? "-rotate-90" : ""}`}
                        />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openProject(p)}
                      title={`${p.name} - ${meta.label}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] text-left focus-visible:outline-none focus-visible:bg-sidebar-accent"
                    >
                      <Icon
                        className={`size-3.5 shrink-0 ${meta.color}`}
                        strokeWidth={1.5}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                    {p.type === "app" ? (
                      <button
                        type="button"
                        aria-label={`Open bots for ${p.name}`}
                        title="Project bots"
                        onClick={() =>
                          router.push(
                            `/agents?project=${encodeURIComponent(p._id)}`,
                          )
                        }
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
                      >
                        <Bot aria-hidden className="size-3" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setPendingRemoval({ id: p._id, name: p.name })
                      }
                      disabled={busyId === p._id}
                      aria-label="Remove project"
                      className="flex size-5 shrink-0 items-center justify-center rounded-[8px] text-transparent transition-colors duration-(--duration-hover) group-hover:text-muted-foreground hover:!bg-sidebar-accent hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent"
                    >
                      {busyId === p._id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </button>
                  </div>
                  {children.length && !collapsedProjects.has(p._id) ? (
                    <div
                      className="ml-4 border-l border-border/60 pl-1"
                      aria-label={`${p.name} conversations`}
                    >
                      {(expanded ? children : children.slice(0, 5)).map(
                        (chat) => (
                          <SidebarConversation key={chat.id} chat={chat} />
                        ),
                      )}
                      {children.length > 5 ? (
                        <button
                          type="button"
                          className="h-7 px-2 text-ui-caption text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setExpandedProjects((previous) => {
                              const next = new Set(previous);
                              if (expanded) next.delete(p._id);
                              else next.add(p._id);
                              return next;
                            })
                          }
                        >
                          {expanded
                            ? "Show less"
                            : `Show ${children.length - 5} more`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      )}

      {filter !== "all" ? (
        <p className="px-2 py-1 text-ui-caption text-muted-foreground">
          {filterLabels[filter as keyof typeof filterLabels]} ·{" "}
          {visibleChats.length} loaded
        </p>
      ) : null}
      {paginationStatus ? (
        <SidebarHistory
          chats={visibleChats.filter(
            (chat) =>
              !chat.project_id ||
              !list.some((project) => project._id === chat.project_id),
          )}
          paginationStatus={paginationStatus}
          loadMore={loadMore}
        />
      ) : null}

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={async (name, type, agentMention) => {
          const res = await createProject({
            name,
            type,
            ...(agentMention ? { agentMention } : {}),
          });
          if (!res.success) {
            toast.error(res.error ?? "Failed to create project");
            return false;
          }
          toast.success(`Created ${name}`);
          return true;
        }}
      />
      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && busyId === null) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemoval?.name ?? "project"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project from the sidebar. Existing conversations
              stay in history, but the project cannot be restored from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingRemoval || busyId !== null}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingRemoval) return;
                void handleRemove(pendingRemoval.id, pendingRemoval.name);
              }}
              className="bg-destructive text-background hover:bg-destructive/90"
            >
              {busyId !== null ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : null}
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
