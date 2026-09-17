import { cn } from "@/lib/utils";

/*
 * The reduced-motion guard lives here, not at the call site.
 *
 * A skeleton communicates through its *shape* — the pulse is decoration on top
 * of a signal that already works without it. Baking `motion-reduce:animate-none`
 * into the primitive means the ~30 places that render one cannot forget it, and
 * a new caller inherits the correct behaviour by default.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-accent animate-pulse rounded-md motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
