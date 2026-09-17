import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading settings">
      <span className="sr-only">Loading settings…</span>
      <Skeleton aria-hidden className="h-6 w-40 motion-reduce:animate-none" />
      <Skeleton
        aria-hidden
        className="mt-2 h-4 w-72 max-w-full motion-reduce:animate-none"
      />
      <div className="mt-7 space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={index}
            aria-hidden
            className="h-16 rounded-md motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
