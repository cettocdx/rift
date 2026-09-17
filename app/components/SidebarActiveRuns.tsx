"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  BuildIcon,
  HackIcon,
  StudioIcon,
  AgentsIcon,
} from "@/lib/ui/workspace-icons";
import { runStatusMeta, toRunStatus } from "@/lib/runs/run-status";
import { formatCursorElapsed } from "@/components/ui/cursor-thinking";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import {
  SIDEBAR_SECTION_LABEL_CLASS,
  sidebarNavRowClass,
} from "@/lib/ui/workspace-chrome";

/**
 * What is running right now, whether or not you are looking at it.
 *
 * An agent turn does not live in the browser -- it runs on a durable worker and
 * keeps going when you close the tab. Production runs of twenty and fifty
 * minutes finish with nobody watching. But the rail only ever showed a small
 * dot on one chat row, so leaving a chat felt exactly like killing the work:
 * nothing anywhere said it was still going, and the honest question "is it
 * still running?" had no answer short of opening the chat again.
 *
 * This is that answer. It reads the run records the backend already writes --
 * status, the user's own words for the goal, and when it started -- so nothing
 * here is inferred from a stream the browser happens to be holding. Runs
 * disappear from the list when the SERVER says they reached a terminal state,
 * which is the only authority that can know.
 */

/** How far back to look. A run that is live now is necessarily a recent one. */
const RUN_SCAN_LIMIT = 60;

/** How many to show before the list becomes a wall. */
const MAX_VISIBLE = 5;

/**
 * Nothing can be running past this, whatever its record says.
 *
 * The worker's hard ceiling is 60 minutes; this is that plus grace. A record
 * older than it that still claims to be live is a record whose producer died
 * without closing it (a cancelled or killed worker does not reliably reach its
 * own cleanup), and the first version of this panel faithfully listed fifteen
 * of those at 900 to 2,200 minutes. The server-side reconciler closes such
 * records; this guard is so the rail never shows one in the meantime.
 */
const RUN_CEILING_MS = 75 * 60 * 1000;

const SURFACE_ICON: Record<string, typeof BuildIcon> = {
  build: BuildIcon,
  studio: StudioIcon,
  hack: HackIcon,
};

/** A clock that only ticks while something is actually on screen. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function SidebarActiveRuns() {
  const runs = useQuery(api.runs.listRuns, { limit: RUN_SCAN_LIMIT });
  const { goChat } = useChatNavigation();

  // Coarse clock for the ceiling test, so a run that crosses it while the
  // panel is open drops out rather than sitting there past its own maximum.
  const [ceilingNow, setCeilingNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCeilingNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const liveCandidates = useMemo(() => {
    if (!runs) return [];
    return (
      runs
        // A closed record is closed whatever its status says: the reconciler
        // writes `disconnected` -- non-terminal in the vocabulary, because a
        // disconnected run can in principle come back -- and sets ended_at,
        // which is the part that means "not any more".
        .filter((run) => run.ended_at === undefined)
        .filter((run) => !runStatusMeta(toRunStatus(run.status)).isTerminal)
        .filter((run) => ceilingNow - run.started_at < RUN_CEILING_MS)
    );
  }, [runs, ceilingNow]);

  // Run history also includes temporary or subsequently deleted chats. Check
  // the existing owner-enforced lookup before offering a conversation link.
  // These subscriptions remain live: pending/failed lookups are not cached as
  // absence, and a newly persisted chat becomes available without a refresh.
  // Confirm worker state independently of the selected conversation. A missing
  // cleanup write must not leave a completed worker ticking in the sidebar.
  const candidateKey = liveCandidates
    .map((r) => `${r.id}:${r.chat_id}`)
    .join("|");
  useEffect(() => {
    if (!candidateKey) return;
    const controller = new AbortController();
    const reconcile = () =>
      fetch("/api/runs/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runs: candidateKey.split("|").map((pair) => {
            const [id, chatId] = pair.split(":");
            return { id, chatId };
          }),
        }),
        signal: controller.signal,
      }).catch(() => undefined);
    void reconcile();
    const timer = setInterval(reconcile, 30_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [candidateKey]);

  const chatQueries = useMemo(
    () =>
      Object.fromEntries(
        liveCandidates.map((run) => [
          `chat:${run.chat_id}`,
          { query: api.chats.getChatByIdFromClient, args: { id: run.chat_id } },
        ]),
      ),
    [liveCandidates],
  );
  const ownedChats = useQueries(chatQueries);
  const active = useMemo(
    () =>
      liveCandidates
        .filter((run) => {
          const chat = ownedChats[`chat:${run.chat_id}`];
          // Unknown availability must not be mistaken for a missing conversation.
          // Keep the run visible while checking, but disable its destination below.
          if (chat === undefined || chat instanceof Error) return true;
          return (
            chat !== null && chat.id === run.chat_id && !chat.console_session
          );
        })
        .slice(0, MAX_VISIBLE),
    [liveCandidates, ownedChats],
  );

  // The clock is the only thing here that costs anything per second, so it does
  // not run when the section is not rendered.
  const now = useNow(active.length > 0);

  if (active.length === 0) return null;

  return (
    <div className="px-2 pb-1" data-testid="sidebar-active-runs">
      <div className="flex h-8 items-center px-1.5">
        <span className={SIDEBAR_SECTION_LABEL_CLASS}>
          Active {active.length > 1 ? `· ${active.length}` : ""}
        </span>
      </div>

      <div className="space-y-px">
        {active.map((run) => {
          const meta = runStatusMeta(toRunStatus(run.status));
          const Icon = SURFACE_ICON[run.surface ?? ""] ?? AgentsIcon;
          // Lifecycle status is authoritative. The optional phase can be seeded
          // once or written after a tool finishes, so it is not current activity.
          // Preserve the user's goal in the destination tooltip.
          const title = run.goal?.trim() || meta.label;
          const chat = ownedChats[`chat:${run.chat_id}`];
          const chatReady =
            chat !== undefined &&
            chat !== null &&
            !(chat instanceof Error) &&
            chat.id === run.chat_id;
          const destinationTitle = chatReady
            ? title === meta.label
              ? title
              : `${title} — ${meta.label}`
            : chat instanceof Error
              ? "Conversation connection unavailable"
              : "Checking conversation availability";
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => {
                if (chatReady) goChat(run.chat_id);
              }}
              disabled={!chatReady}
              aria-busy={chat === undefined || undefined}
              title={destinationTitle}
              className={`${sidebarNavRowClass(false)} text-left`}
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <Icon
                  aria-hidden
                  className="size-4 text-[var(--cursor-icon-secondary)]"
                />
                {/* A working run breathes; a waiting one does not. Motion here
                    is the status, so it must not run for a run that is idle. */}
                {meta.tone === "active" ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[var(--success)] motion-safe:animate-pulse"
                  />
                ) : null}
              </span>

              <span className="min-w-0 flex-1 truncate">{meta.label}</span>

              <span className="rift-chat-time">
                {formatCursorElapsed(Math.max(0, now - run.started_at))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
