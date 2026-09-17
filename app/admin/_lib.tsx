"use client";

import type { ReactNode, SVGProps } from "react";

/* ------------------------------------------------------------------ helpers */

export const cn = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const fmtMoney = (n: number) =>
  n === 0
    ? "$0"
    : n < 1
      ? `$${n.toFixed(2)}`
      : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const shortId = (id: string) => id.slice(-4).toUpperCase();

/* -------------------------------------------------------------- primitives */
/* One accent (emerald). Everything else is neutral. Amber/rose are reserved
 * for genuine status, never decoration. */

type Tone = "emerald" | "neutral" | "bright" | "amber" | "rose";

const TONE: Record<Tone, string> = {
  emerald: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/20",
  neutral: "text-neutral-400 bg-neutral-500/10 ring-neutral-500/15",
  bright: "text-neutral-100 bg-neutral-100/[0.06] ring-neutral-100/15",
  amber: "text-amber-300 bg-amber-500/10 ring-amber-500/20",
  rose: "text-rose-300 bg-rose-500/10 ring-rose-500/20",
};

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Status indicator — semantic only. */
export function StatusDot({
  state,
  label,
}: {
  state: "ok" | "pending" | "fail" | "na";
  label?: string;
}) {
  const accessibleLabel =
    label ??
    {
      ok: "Available",
      pending: "Pending",
      fail: "Unavailable",
      na: "Not applicable",
    }[state];
  if (state === "na")
    return (
      <span
        aria-label={accessibleLabel}
        role="img"
        className="text-neutral-700"
      >
        ·
      </span>
    );
  const map = {
    ok: {
      ring: "ring-emerald-500/25 bg-emerald-500/10 text-emerald-400",
      icon: <Check className="h-3 w-3" />,
    },
    pending: {
      ring: "ring-amber-500/25 bg-amber-500/10 text-amber-400",
      icon: <Clock className="h-3 w-3" />,
    },
    fail: {
      ring: "ring-rose-500/25 bg-rose-500/10 text-rose-400",
      icon: <X className="h-3 w-3" />,
    },
  }[state];
  return (
    <span
      aria-label={accessibleLabel}
      role="img"
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-inset",
        map.ring,
      )}
    >
      {map.icon}
    </span>
  );
}

export function tierPill(tier: string | null) {
  if (tier === "ultra") return <Pill tone="emerald">Max</Pill>;
  if (tier === "pro") return <Pill tone="bright">Pro</Pill>;
  return <Pill tone="neutral">Free</Pill>;
}

/* -------------------------------------------------------------------- icons */

type I = SVGProps<SVGSVGElement>;
const base = (p: I) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});
export const Users = (p: I) => (
  <svg {...base(p)}>
    <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
    <circle cx="9" cy="7" r="3" />
    <path d="M22 19v-1a4 4 0 0 0-3-3.87M16 4.13A4 4 0 0 1 16 11.9" />
  </svg>
);
export const Chat = (p: I) => (
  <svg {...base(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
  </svg>
);
export const Grid = (p: I) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);
export const Clock = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const Check = (p: I) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const X = (p: I) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const Chevron = (p: I) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
export const Search = (p: I) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const Shield = (p: I) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
export const Gear = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.1-2.9H2a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.1-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const Pulse = (p: I) => (
  <svg {...base(p)}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
export const Coin = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9.5A3 3 0 0 0 12 8c-1.7 0-3 1-3 2s1 1.7 3 2 3 1 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6.5v11" />
  </svg>
);
export const Sidebar = (p: I) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);
