"use client";

import { Suspense, type ReactNode } from "react";

/** A cold tool chunk must never hide the conversation or reset its focus. */
export function WorkbenchBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-label="Loading workspace panel"
          className="h-full min-h-0 w-full px-4 py-5 text-[13px] text-muted-foreground"
        >
          Loading panel…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
