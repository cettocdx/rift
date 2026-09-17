import { cn } from "@/lib/utils";

interface SourceDomainBadgeProps {
  source: string;
  className?: string;
}

export function getSourceHost(source: string): string {
  try {
    const hostname = new URL(source).hostname.replace(/^www\./i, "");
    if (hostname) return hostname;
  } catch {
    // Fall through to a deterministic label for partial or malformed URLs.
  }

  const candidate = source
    .trim()
    .replace(/^(?:https?:)?\/\//i, "")
    .split(/[/?#]/, 1)[0]
    .replace(/^www\./i, "");
  return candidate || "source";
}

export function SourceDomainBadge({
  source,
  className,
}: SourceDomainBadgeProps) {
  const host = getSourceHost(source);
  const initial = host.match(/[a-z0-9]/i)?.[0]?.toUpperCase() ?? "S";

  return (
    <span
      role="img"
      aria-label={`${host} source`}
      title={host}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border/80 bg-muted/70 text-[8px] font-semibold leading-none text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
