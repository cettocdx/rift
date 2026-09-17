"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";

export default function StudioError({ reset }: { reset: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-4 text-foreground">
      <div
        className="w-full max-w-sm rounded-[12px] border border-border bg-surface-1 p-5 text-left"
        role="alert"
      >
        <span className="flex size-8 items-center justify-center rounded-[8px] border border-destructive/30 bg-destructive/[0.07] text-destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-[16px] font-semibold">Studio did not open</h1>
        <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
          The media workspace could not be loaded. Your conversation and saved
          outputs were not changed.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-[8px] bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none motion-reduce:transition-none"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  );
}
