"use client";

import { MonitorPlay, ArrowUpRight } from "lucide-react";
import { useGlobalState } from "../contexts/GlobalState";

/** A preview result stays inline until the user chooses to open it. */
export function ExposePreviewCard({
  url,
  error,
}: {
  url?: string;
  error?: string;
}) {
  const {
    setBuildPreviewUrl,
    setBuildPreviewOpen,
    buildPreviewUrl,
    buildPreviewOpen,
  } = useGlobalState();
  if (!url) {
    if (!error) return null;
    return (
      <div className="my-1 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm text-muted-foreground">
        Couldn&apos;t open the preview. {error}
      </div>
    );
  }

  const isShown = buildPreviewOpen && buildPreviewUrl === url;

  return (
    <button
      type="button"
      onClick={() => {
        setBuildPreviewUrl(url);
        setBuildPreviewOpen(true);
      }}
      className="group my-1 flex w-full max-w-lg items-center gap-3 rounded-lg border border-border bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MonitorPlay className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          Preview available
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {url}
        </span>
      </span>
      <span className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        {isShown ? "Shown" : "Open"}
        <ArrowUpRight className="size-3.5" />
      </span>
    </button>
  );
}
