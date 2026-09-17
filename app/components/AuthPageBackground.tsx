"use client";

import { RiftHeroCanvas } from "./landing/RiftHeroCanvas";

/** Subtle animated backdrop for auth pages — matches Rift 2 landing. */
export function AuthPageBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[520px] opacity-[0.22]">
        <RiftHeroCanvas />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(217, 119, 87,0.1),transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/75 to-background" />
    </div>
  );
}
