"use client";

import Link from "next/link";
import { CircleAlert, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PluginsError({ reset }: { reset: () => void }) {
  return (
    <main className="flex h-full min-h-[60dvh] items-center justify-center bg-background px-5 py-12 text-foreground">
      <section
        aria-labelledby="plugins-error-title"
        className="w-full max-w-md rounded-lg border border-border/80 bg-card/[0.14] px-6 py-8 text-center dark:bg-[#212121]"
      >
        <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground">
          <CircleAlert className="size-4" strokeWidth={1.7} aria-hidden />
        </div>
        <h1
          id="plugins-error-title"
          className="mt-4 text-[17px] font-semibold text-foreground"
        >
          Connections could not load
        </h1>
        <p
          role="alert"
          className="mt-1.5 text-[13px] leading-5 text-muted-foreground"
        >
          Saved plugins were not changed. Retry connection sync or return to
          Build.
        </p>
        <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button asChild size="sm" variant="outline" className="h-10 sm:h-9">
            <Link href="/">Open Build</Link>
          </Button>
          <Button size="sm" onClick={reset} className="h-10 gap-1.5 sm:h-9">
            <RefreshCcw className="size-3.5" aria-hidden />
            Retry connections
          </Button>
        </div>
      </section>
    </main>
  );
}
