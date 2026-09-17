"use client";

import { RefreshCcw } from "lucide-react";
import Link from "next/link";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12 text-foreground">
      <section
        aria-labelledby="app-error-title"
        className="w-full max-w-md rounded-xl border border-border/80 bg-card/60 p-7 text-center shadow-sm"
      >
        <div className="mx-auto flex size-9 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
          <RefreshCcw aria-hidden className="size-4" strokeWidth={1.7} />
        </div>
        <h1 id="app-error-title" className="mt-4 text-lg font-semibold">
          RIFT could not finish loading
        </h1>
        <p
          role="alert"
          className="mt-2 text-sm leading-6 text-muted-foreground"
        >
          Your work is still safe. Retry this view or return to the workspace.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none"
          >
            Open workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
