"use client";

import { RiftLogo } from "@/components/icons/rift-logo";

interface RiftBrandBarProps {
  /** Accepted for backward-compat; no longer rendered. */
  version?: string;
  cwd?: string;
  status?: { label: string; tone?: "ok" | "warn" | "muted" };
  className?: string;
}

/**
 * Brand row at the top of the chat surface: just the mascot. The RIFT wordmark
 * and the version / working-dir / "sandbox ready" labels were removed for a
 * clean, minimal header.
 */
export function RiftBrandBar({ className = "" }: RiftBrandBarProps) {
  return (
    <div
      className={`flex w-full shrink-0 items-center gap-3 overflow-visible border-b border-sidebar-border bg-background px-5 py-3 ${className}`}
      data-testid="rift-brand-bar"
    >
      <div className="flex shrink-0 items-center overflow-visible">
        <RiftLogo size={35} className="shrink-0" />
      </div>
    </div>
  );
}
