import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this the route showed nothing at all until its data arrived, which
 * on a cold navigation reads as a broken click rather than a loading page.
 * Shaped like the rows that are coming, so the layout does not jump when they
 * land.
 */
export default function ArtifactsRouteLoading() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background px-5 py-5 md:px-7"
      role="status"
      aria-label="Loading artifacts"
    >
      <span className="sr-only">Loading artifacts…</span>
      <Skeleton aria-hidden className="h-6 w-32 motion-reduce:animate-none" />
      <Skeleton
        aria-hidden
        className="mt-3 h-4 w-80 max-w-full motion-reduce:animate-none"
      />
      <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            aria-hidden
            className="h-28 rounded-md motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
