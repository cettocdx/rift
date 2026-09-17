"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface SettingsSurfaceLinkProps {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  /**
   * Only the dialog needed this — it had to close itself before the link
   * navigated. A settings route has nothing to close, so it is optional.
   */
  onNavigate?: () => void;
}

export function SettingsSurfaceLink({
  title,
  description,
  href,
  actionLabel,
  onNavigate,
}: SettingsSurfaceLinkProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0 max-[460px]:flex-col max-[460px]:gap-2">
      <div className="min-w-0">
        <h4 className="text-[12px] font-medium">{title}</h4>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {description}
        </p>
      </div>
      <Link
        href={href}
        onClick={onNavigate}
        className="inline-flex h-7 shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground/85 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
      >
        {actionLabel}
        <ArrowUpRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}
