"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TasksError({ reset }: { reset: () => void }) {
  return (
    <div className="flex h-full min-h-[60dvh] items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-md border border-border/80 bg-card/[0.18] px-6 py-8 text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertTriangle className="size-[18px]" strokeWidth={1.6} />
        </div>
        <h1 className="mt-4 text-[18px] font-semibold text-foreground">
          Tasks could not be loaded
        </h1>
        <p
          role="alert"
          className="mt-1.5 text-[14px] leading-6 text-muted-foreground"
        >
          Check your connection and try loading this page again.
        </p>
        <Button
          onClick={reset}
          size="sm"
          className="mt-5 h-8 rounded-md text-[13px]"
        >
          <RefreshCcw className="size-3.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}
