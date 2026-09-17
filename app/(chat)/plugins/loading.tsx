import { Skeleton } from "@/components/ui/skeleton";

export default function PluginsLoading() {
  return (
    <main
      className="terminal-scrollbar h-full min-h-0 overflow-y-auto bg-background px-5 py-6 md:px-7 md:py-8"
      aria-label="Loading plugins"
      aria-busy="true"
    >
      <div className="mx-auto w-full max-w-[960px]">
        <span className="sr-only">Loading plugins and connection health…</span>
        <Skeleton aria-hidden className="h-7 w-28 motion-reduce:animate-none" />
        <Skeleton
          aria-hidden
          className="mt-2 h-4 w-[520px] max-w-full motion-reduce:animate-none"
        />
        <div className="mt-7 flex flex-col gap-2 sm:flex-row">
          <Skeleton
            aria-hidden
            className="h-10 min-w-0 flex-1 rounded-md motion-reduce:animate-none sm:h-9"
          />
          <Skeleton
            aria-hidden
            className="h-10 w-full rounded-md motion-reduce:animate-none sm:h-9 sm:w-36"
          />
        </div>
        <Skeleton
          aria-hidden
          className="mt-3 h-9 w-72 max-w-full rounded-md motion-reduce:animate-none"
        />
        <section className="mt-7" aria-hidden>
          <Skeleton className="mb-2 h-4 w-24 motion-reduce:animate-none" />
          <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                <Skeleton className="size-10 shrink-0 rounded-md motion-reduce:animate-none" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
                  <Skeleton className="mt-2 h-3 w-64 max-w-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-8 w-24 rounded-md motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
