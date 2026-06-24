"use client";

import { useEffect } from "react";
import { RiftWordmark } from "@/components/icons/rift-wordmark";

/**
 * Route-level error boundary for /admin. Without this, any error thrown while
 * rendering the dashboard (e.g. the stats query failing) bubbles past React
 * with no fallback — on mobile Safari that surfaces as a blank "This page
 * couldn't load" screen. Catching it here keeps the page recoverable.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Admin] dashboard failed to load:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <RiftWordmark height={16} className="text-foreground" />
      <p className="text-sm text-muted-foreground">
        The admin dashboard couldn&apos;t load.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}
