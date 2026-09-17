"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  fmtRelative,
  fmtMoney,
  tierPill,
  Users as UsersIcon,
  Chat,
  Pulse,
  Coin,
  Chevron,
} from "./_lib";

export default function AdminOverview() {
  const stats = useQuery(api.admin.getAdminStats);
  const activity = useQuery(api.admin.getAdminActivity);
  const loading = stats === undefined;
  const anyLimited = stats ? Object.values(stats.limited).some(Boolean) : false;

  const recentUsers = (stats?.users ?? []).slice(0, 7);
  const recentChats = (activity ?? []).slice(0, 7);

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col md:h-[100dvh]">
      <header className="flex items-center justify-between border-b border-neutral-800/70 px-4 py-4 sm:px-6 md:px-8 md:py-5">
        <h1 className="text-[15px] font-semibold text-neutral-100">
          Dashboard
        </h1>
        <span className="flex items-center gap-2 text-[12px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Live
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6 md:px-8 md:py-6">
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Users"
            value={
              loading
                ? "—"
                : `${stats!.limited.users ? "≥" : ""}${stats!.totalUsers.toLocaleString()}`
            }
            icon={<UsersIcon className="h-4 w-4" />}
          />
          <Stat
            label="Active · 7d"
            value={
              loading
                ? "—"
                : `${stats!.limited.chats ? "≥" : ""}${stats!.activeLast7Days.toLocaleString()}`
            }
            icon={<Pulse className="h-4 w-4" />}
          />
          <Stat
            label="Conversations"
            value={
              loading
                ? "—"
                : `${stats!.limited.chats ? "≥" : ""}${stats!.totalChats.toLocaleString()}`
            }
            icon={<Chat className="h-4 w-4" />}
          />
          <Stat
            label="Revenue"
            value={
              loading
                ? "—"
                : `${stats!.limited.revenue ? "≥" : ""}${fmtMoney(stats!.totalRevenueDollars)}`
            }
            icon={<Coin className="h-4 w-4" />}
            accent
          />
        </div>

        {anyLimited && (
          <p className="mt-3 text-[11px] leading-5 text-neutral-600">
            Large datasets are shown as a bounded recent window; ≥ values are
            safe lower bounds.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel
            title="Recent signups"
            href="/admin/users"
            hrefLabel="All users"
          >
            {recentUsers.map((u) => (
              <Row key={u.id}>
                <Avatar seed={u.name ?? u.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-neutral-100">
                    {u.name ?? "—"}
                  </div>
                  <div className="truncate text-[11.5px] text-neutral-500">
                    {u.email}
                  </div>
                </div>
                {tierPill(u.tier)}
                <span className="w-16 text-right text-[11.5px] tabular-nums text-neutral-500">
                  {fmtRelative(u.joinedAt)}
                </span>
              </Row>
            ))}
            {!loading && recentUsers.length === 0 && (
              <Empty>No users yet.</Empty>
            )}
            {loading && <Skeleton rows={5} />}
          </Panel>

          <Panel
            title="Recent conversations"
            href="/admin/conversations"
            hrefLabel="All"
          >
            {recentChats.map((c) => (
              <Row key={c.chatId}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-800/60 text-neutral-500">
                  <Chat className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-neutral-100">
                    {c.title}
                  </div>
                  <div className="truncate text-[11.5px] text-neutral-500">
                    {c.name ?? c.email}
                  </div>
                </div>
                <span className="w-16 text-right text-[11.5px] tabular-nums text-neutral-500">
                  {fmtRelative(c.updatedAt)}
                </span>
              </Row>
            ))}
            {activity && recentChats.length === 0 && (
              <Empty>No conversations yet.</Empty>
            )}
            {activity === undefined && <Skeleton rows={5} />}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-800/70 bg-neutral-900/30 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-neutral-500">
          {label}
        </span>
        <span className={accent ? "text-emerald-400/80" : "text-neutral-600"}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-[26px] font-semibold leading-none tabular-nums text-neutral-100">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-800/70 bg-neutral-900/30">
      <div className="flex items-center justify-between border-b border-neutral-800/70 px-4 py-3">
        <h2 className="text-[12.5px] font-medium text-neutral-300">{title}</h2>
        <Link
          href={href}
          className="group flex items-center gap-1 text-[11.5px] text-neutral-500 transition-colors hover:text-neutral-200"
        >
          {hrefLabel}
          <Chevron className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="px-4">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-neutral-800/40 py-2.5 last:border-0">
      {children}
    </div>
  );
}

function Avatar({ seed }: { seed: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-300">
      {seed.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-10 text-center text-[12.5px] text-neutral-600">
      {children}
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 py-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-neutral-900" />
      ))}
    </div>
  );
}
