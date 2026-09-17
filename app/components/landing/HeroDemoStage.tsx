"use client";

import type { ReactNode } from "react";

/** Cinematic stage wrapper — compact for split hero, full for featured demos. */
export function HeroDemoStage({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="relative h-[400px] sm:h-[440px]">
        <div
          className="pointer-events-none absolute -inset-4 rounded-2xl opacity-50 blur-2xl motion-reduce:opacity-30"
          style={{
            background:
              "radial-gradient(ellipse 70% 50% at 50% 20%, rgba(217, 119, 87,0.14), transparent 70%)",
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute -inset-px rounded-xl border border-signal/15" />
        <div className="relative h-full [transform:rotateX(1.5deg)] transform-gpu">
          {children}
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-signal/25 bg-background/75 px-2.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-signal backdrop-blur-md">
          <span className="size-1 rounded-full bg-signal" />
          Live
        </div>
      </div>
    );
  }

  return (
    <div className="rift2-demo-stage relative h-full min-h-[380px] sm:min-h-[480px] lg:min-h-[calc(100dvh-11rem)]">
      <div
        className="pointer-events-none absolute -inset-6 rounded-[32px] opacity-70 blur-3xl motion-reduce:opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(217, 119, 87,0.18), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute -inset-px rounded-2xl border border-signal/20 lg:rounded-[20px]" />
      <div className="relative flex h-full flex-col [perspective:1400px]">
        <div className="rift2-demo-tilt relative min-h-0 flex-1 transform-gpu">
          {children}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background via-background/80 to-transparent lg:h-28" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-signal/30 bg-background/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-signal backdrop-blur-md sm:left-6">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
        </span>
        Live demo
      </div>
    </div>
  );
}
