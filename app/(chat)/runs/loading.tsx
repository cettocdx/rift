import { Skeleton } from "@/components/ui/skeleton";

export default function RunsRouteLoading() {
  return (
    <main
      className="mx-auto w-full max-w-[960px] px-6 py-10"
      role="status"
      aria-label="Loading runs"
    >
      <span className="sr-only">Loading runs…</span>
      <Skeleton aria-hidden className="h-6 w-24 motion-reduce:animate-none" />
      <Skeleton
        aria-hidden
        className="mt-3 h-4 w-80 max-w-full motion-reduce:animate-none"
      />
      <div className="mt-6 flex gap-2" aria-hidden>
        {[72, 90, 110].map((width) => (
          <Skeleton
            key={width}
            style={{ width }}
            className="h-8 rounded-md motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="mt-6 space-y-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-16 rounded-lg motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
