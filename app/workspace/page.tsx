"use client";

import { Chat } from "@/app/components/chat";
import { useHydrated } from "@/app/hooks/useHydrated";
import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspacePage() {
  const hydrated = useHydrated();

  // Returning null here painted a blank agent pane until hydration finished —
  // indistinguishable from a workspace that failed to open. The panel keeps
  // its shape instead, so the wait reads as loading rather than as nothing.
  if (!hydrated) {
    return (
      <div
        className="flex h-full min-h-0 flex-col justify-end gap-3 bg-background px-5 py-5"
        role="status"
        aria-label="Opening the workspace"
      >
        <span className="sr-only">Opening the workspace…</span>
        <Skeleton
          aria-hidden
          className="h-4 w-48 motion-reduce:animate-none"
        />
        <Skeleton
          aria-hidden
          className="h-4 w-72 max-w-full motion-reduce:animate-none"
        />
        <Skeleton
          aria-hidden
          className="mt-auto h-[104px] w-full rounded-xl motion-reduce:animate-none"
        />
      </div>
    );
  }

  return <Chat autoResume={false} />;
}
