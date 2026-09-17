"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Check,
  ChevronDown,
  Lock,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  GithubConnectButton,
  GithubMark as Github,
} from "./GithubConnectButton";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ActiveProjectContext } from "@/types/chat";
import type { SidebarConversationRecord } from "./SidebarConversation";
import {
  SIDEBAR_SECTION_LABEL_CLASS,
  sidebarNavRowClass,
} from "./SidebarHeader";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { observeChatViewport } from "./chat-layout/ChatViewport";

type Repository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export function SidebarGithub({
  chats = [],
}: {
  chats?: SidebarConversationRecord[];
}) {
  const status = useQuery(api.github.getStatus, {});
  const projects = useQuery(
    api.projects.listForUser,
    status?.connected ? {} : "skip",
  );
  const [expanded, setExpanded] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [retryPage, setRetryPage] = useState<number | null>(null);
  // Bridge the REST response to the live project subscription. Once the
  // subscription has acknowledged an addition, it owns removal/rename updates.
  const [pendingProjects, setPendingProjects] = useState<
    Record<number, string>
  >({});
  const request = useRef<AbortController | null>(null);
  const openRequest = useRef<AbortController | null>(null);
  const {
    initializeNewChat,
    closeSidebar,
    setChatSidebarOpen,
    setTemporaryChatsEnabled,
    setActiveProject,
  } = useGlobalState();
  const { goPurpose } = useChatNavigation();
  const mobile = useIsMobile();
  // Observe when Radix attaches the portal, including its first opening.
  const attachPicker = useCallback((node: HTMLDivElement | null) => {
    if (node) return observeChatViewport(node);
  }, []);

  const load = useCallback(async (nextPage: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setRetryPage(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, 30_000);
    try {
      const response = await fetch(
        `/api/github/repositories?page=${nextPage}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Could not load repositories. Try again.",
        );
      if (controller.signal.aborted) return;
      setRepositories((previous) =>
        nextPage === 1
          ? result.repositories
          : Array.from(
              new Map(
                [...previous, ...result.repositories].map((repo) => [
                  repo.id,
                  repo,
                ]),
              ).values(),
            ),
      );
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (cause) {
      if (!controller.signal.aborted || timedOut) {
        setRetryPage(nextPage);
        setError(
          timedOut
            ? "Loading repositories timed out. Try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load repositories.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRepositories([]);
    setPendingProjects({});
    setPickerOpen(false);
    setPage(0);
    setHasMore(false);
    setLoading(false);
    setError("");
    setActionError("");
    setAnnouncement("");
    setOpening(null);
    return () => {
      request.current?.abort();
      openRequest.current?.abort();
    };
  }, [status?.connected, status?.username]);

  useEffect(() => {
    if (!projects) return;
    setPendingProjects((previous) => {
      const acknowledged = Object.entries(previous).filter(([, projectId]) =>
        projects.some((project) => project._id === projectId),
      );
      if (acknowledged.length === 0) return previous;
      const next = { ...previous };
      for (const [repoId] of acknowledged) delete next[Number(repoId)];
      return next;
    });
  }, [projects, pendingProjects]);

  const changePickerOpen = (nextOpen: boolean) => {
    setPickerOpen(nextOpen);
    setActionError("");
    setAnnouncement("");
    if (nextOpen) {
      setQuery("");
      void load(1);
    } else {
      request.current?.abort();
      openRequest.current?.abort();
      setLoading(false);
      setOpening(null);
    }
  };

  const chooseRepository = async (repo: Repository, startWork: boolean) => {
    if (openRequest.current && !openRequest.current.signal.aborted) return;
    const controller = new AbortController();
    openRequest.current = controller;
    setOpening(repo.fullName);
    setActionError("");
    setAnnouncement("");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, 30_000);
    try {
      const response = await fetch("/api/github/repositories/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: repo.fullName }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Could not add this repository. Try again.",
        );
      if (controller.signal.aborted) return;
      const project = result.project as ActiveProjectContext;
      setPendingProjects((previous) => ({
        ...previous,
        [repo.id]: project.id,
      }));
      if (!startWork) {
        setAnnouncement(`${repo.fullName} added to Projects.`);
        return;
      }
      setPickerOpen(false);
      const recent = chats.find((chat) => chat.project_id === project.id);
      closeSidebar();
      if (mobile) setChatSidebarOpen(false);
      setTemporaryChatsEnabled(false);
      if (recent) {
        setActiveProject(project);
        goPurpose("app", recent.id);
      } else {
        initializeNewChat("app", project);
        goPurpose("app");
      }
    } catch (cause) {
      if (!controller.signal.aborted || timedOut)
        setActionError(
          timedOut
            ? "Adding the repository timed out. Check Projects or try again."
            : cause instanceof Error
              ? cause.message
              : "Could not add this repository. Try again.",
        );
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
      if (openRequest.current === controller) setOpening(null);
    }
  };

  const selectedIds = new Set([
    ...(projects ?? []).flatMap((project) =>
      project.github_repository ? [project.github_repository.id] : [],
    ),
    ...Object.keys(pendingProjects).map(Number),
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = repositories.filter((repo) =>
    repo.fullName.toLowerCase().includes(normalizedQuery),
  );

  return (
    <section aria-label="GitHub repositories" className="mb-3 px-2">
      <button
        type="button"
        className={`${SIDEBAR_SECTION_LABEL_CLASS} flex min-h-8 w-full items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Github className="size-4" aria-hidden />
        GitHub
        <ChevronDown
          className={`ml-auto size-3.5 ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="space-y-1">
          <GithubConnectButton variant="sidebar" />
          {status?.connected && (
            <Dialog open={pickerOpen} onOpenChange={changePickerOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className={`${sidebarNavRowClass(false)} w-full gap-2 [@media(pointer:coarse)]:min-h-11`}
                >
                  <Plus className="size-4 shrink-0" aria-hidden />
                  Add repositories
                </button>
              </DialogTrigger>
              <DialogContent
                ref={attachPicker}
                showCloseButton={false}
                className="flex flex-col gap-3 overflow-hidden sm:max-w-lg"
                style={{
                  top: "calc(var(--rift-chat-viewport-offset, 0px) + var(--rift-chat-viewport-height, 100%) / 2)",
                  maxHeight:
                    "min(42rem, calc(var(--rift-chat-viewport-height, 100dvh) - 2rem))",
                }}
              >
                <DialogHeader>
                  <DialogTitle>Add GitHub repositories</DialogTitle>
                  <DialogDescription>
                    Add repositories to Projects in your sidebar, then open one
                    to start working.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                    <Search className="size-3.5 shrink-0" aria-hidden />
                    <input
                      type="text"
                      aria-label="Filter loaded GitHub repositories"
                      placeholder="Find a repository…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="min-w-0 w-full bg-transparent py-2 text-[13px] text-foreground outline-none focus-visible:outline-none! [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-[16px]"
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Refresh GitHub repositories"
                    disabled={loading}
                    onClick={() => void load(1)}
                    className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [@media(pointer:coarse)]:size-11"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                  </button>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                  aria-busy={loading}
                >
                  <ul className="space-y-1">
                    {visible.map((repo) => {
                      const added = selectedIds.has(repo.id);
                      return (
                        <li key={repo.id}>
                          <button
                            type="button"
                            title={`${repo.fullName} · ${repo.defaultBranch}`}
                            aria-label={`${added ? "Open" : "Add"} repository ${repo.fullName}`}
                            disabled={opening !== null}
                            onClick={() => void chooseRepository(repo, added)}
                            className="flex min-h-14 w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                          >
                            {opening === repo.fullName ? (
                              <Loader2
                                className="size-4 shrink-0 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Github className="size-4 shrink-0" aria-hidden />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium">
                                  {repo.fullName}
                                </span>
                                {repo.private && (
                                  <Lock
                                    className="size-3 shrink-0"
                                    aria-label="Private"
                                  />
                                )}
                              </span>
                              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                {added ? (
                                  <>
                                    <Check
                                      className="size-3 shrink-0"
                                      aria-hidden
                                    />
                                    <span>Added</span>
                                  </>
                                ) : (
                                  repo.defaultBranch
                                )}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {added ? "Open" : "Add"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {loading && (
                    <p
                      role="status"
                      className="px-2 py-3 text-xs text-muted-foreground"
                    >
                      Loading repositories…
                    </p>
                  )}
                  {!loading && !error && visible.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      {normalizedQuery
                        ? "No matches in loaded repositories."
                        : "No repositories available to this connection."}
                    </p>
                  )}
                  {error && (
                    <div
                      role="alert"
                      className="px-2 py-2 text-xs text-destructive"
                    >
                      {error}
                      {retryPage !== null && (
                        <button
                          type="button"
                          className="ml-2 min-h-9 underline [@media(pointer:coarse)]:min-h-11"
                          onClick={() => void load(retryPage)}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                  {hasMore && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void load(page + 1)}
                      className="min-h-9 px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"
                    >
                      Load more repositories
                    </button>
                  )}
                </div>
                {actionError && (
                  <p role="alert" className="shrink-0 text-xs text-destructive">
                    {actionError}
                  </p>
                )}
                <div className="flex shrink-0 items-center gap-3 border-t border-border pt-3">
                  <p
                    role="status"
                    className="min-w-0 flex-1 break-words text-xs text-muted-foreground"
                  >
                    {announcement ||
                      (selectedIds.size > 0
                        ? `${selectedIds.size} ${selectedIds.size === 1 ? "repository" : "repositories"} in Projects`
                        : "Choose the repositories you want to work on.")}
                  </p>
                  <DialogClose asChild>
                    <Button
                      variant="outline"
                      className="shrink-0 [@media(pointer:coarse)]:min-h-11"
                    >
                      Done
                    </Button>
                  </DialogClose>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </section>
  );
}
