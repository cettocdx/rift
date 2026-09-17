"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatTokens } from "@/lib/billing/token-display";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cn,
  fmtRelative,
  fmtDate,
  fmtMoney,
  shortId,
  Pill,
  StatusDot,
  tierPill,
  Search,
  Chat,
  X,
  Chevron,
} from "../_lib";

type Stats = NonNullable<FunctionReturnType<typeof api.admin.getAdminStats>>;
type UserRow = Stats["users"][number];
type Activity = NonNullable<
  FunctionReturnType<typeof api.admin.getAdminActivity>
>;
type PlanFilter = "free" | "pro" | "ultra" | null;
type SortKey = "balance" | "revenue" | "chats" | "joined";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;
const ACTIVE_WINDOW = 7 * 24 * 60 * 60 * 1000;
const CLOCK_TICK_MS = 60 * 1000;

export default function UsersPage() {
  const stats = useQuery(api.admin.getAdminStats);
  const activity = useQuery(api.admin.getAdminActivity);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState<PlanFilter>(null);
  const [sort, setSort] = useState<{
    key: SortKey;
    dir: "asc" | "desc";
  } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, CLOCK_TICK_MS);

    return () => window.clearInterval(interval);
  }, []);

  const cyclePlan = () =>
    setPlanFilter((p) =>
      p === null
        ? "ultra"
        : p === "ultra"
          ? "pro"
          : p === "pro"
            ? "free"
            : null,
    );
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s?.key === key
        ? s.dir === "desc"
          ? { key, dir: "asc" }
          : null
        : { key, dir: "desc" },
    );

  const users = useMemo(() => {
    let list = stats?.users ?? [];
    const query = q.trim().toLowerCase();
    if (query)
      list = list.filter(
        (u) =>
          (u.name ?? "").toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query) ||
          shortId(u.id).toLowerCase().includes(query),
      );
    if (planFilter)
      list = list.filter((u) =>
        planFilter === "free" ? u.tier === null : u.tier === planFilter,
      );
    if (sort) {
      const val = (u: UserRow) =>
        sort.key === "balance"
          ? u.balancePoints
          : sort.key === "revenue"
            ? u.revenueDollars
            : sort.key === "chats"
              ? u.chatCount
              : u.joinedAt;
      list = [...list].sort((a, b) => {
        const d = val(a) - val(b);
        return sort.dir === "desc" ? -d : d;
      });
    }
    return list;
  }, [stats, q, planFilter, sort]);

  const selected = useMemo(
    () => stats?.users.find((u) => u.id === selectedId) ?? null,
    [stats, selectedId],
  );

  const loading = stats === undefined;
  const closeUserDetails = () => {
    setSelectedId(null);
    window.setTimeout(() => detailsTriggerRef.current?.focus(), 0);
  };

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col md:h-[100dvh]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/70 px-4 py-4 sm:px-6 md:px-8 md:py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold text-neutral-100">Users</h1>
          <span className="text-[12px] tabular-nums text-neutral-500">
            {stats
              ? `${stats.users.length.toLocaleString()}${stats.limited.users ? "+" : ""}`
              : "—"}
          </span>
        </div>
        <span className="flex items-center gap-2 text-[12px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {stats?.activeLast7Days ?? "—"} active · 7d
        </span>
      </header>

      <div className="px-4 pt-4 sm:px-6 md:px-8 md:pt-5">
        <label className="flex items-center gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3.5 py-2.5 focus-within:border-neutral-700">
          <span className="sr-only">Search users</span>
          <Search aria-hidden="true" className="h-4 w-4 text-neutral-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or ID"
            aria-controls="admin-users-table"
            className="w-full bg-transparent text-[13px] text-neutral-200 placeholder:text-neutral-600 focus:outline-none"
          />
        </label>
        {stats && Object.values(stats.limited).some(Boolean) && (
          <p className="mt-2 text-[11px] leading-5 text-neutral-600">
            Showing a bounded recent window to keep the dashboard responsive at
            large scale.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6 md:px-8 md:pb-8">
        <table
          id="admin-users-table"
          className="w-full min-w-[1080px] border-separate border-spacing-0 text-[13px]"
        >
          <thead className="sticky top-0 z-10 bg-neutral-950">
            <tr className="text-left text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
              <Th className="w-16">ID</Th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th className="w-20">Status</Th>
              <PlanTh
                className="w-20"
                filter={planFilter}
                onCycle={cyclePlan}
              />
              <SortTh
                className="w-24"
                label="Joined"
                col="joined"
                sort={sort}
                onSort={toggleSort}
              />
              <SortTh
                className="w-28"
                align="right"
                label="Balance"
                col="balance"
                sort={sort}
                onSort={toggleSort}
              />
              <SortTh
                className="w-14"
                align="right"
                label="Chats"
                col="chats"
                sort={sort}
                onSort={toggleSort}
              />
              <SortTh
                className="w-20"
                align="right"
                label="Revenue"
                col="revenue"
                sort={sort}
                onSort={toggleSort}
              />
              <Th className="w-12 text-center">Paid</Th>
              <Th className="w-12 text-center">Live</Th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 14 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={11} className="px-3 py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-neutral-900 motion-reduce:animate-none" />
                  </td>
                </tr>
              ))}

            {!loading && users.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-16 text-center text-[13px] text-neutral-600"
                >
                  No users match your search.
                </td>
              </tr>
            )}

            {!loading &&
              users.map((u) => {
                const active =
                  now !== null &&
                  u.lastActiveAt !== null &&
                  now - u.lastActiveAt < ACTIVE_WINDOW;
                const staleDays =
                  now !== null && u.lastActiveAt
                    ? (now - u.lastActiveAt) / 86_400_000
                    : Infinity;
                const live =
                  now === null || u.lastActiveAt === null
                    ? "na"
                    : active
                      ? "ok"
                      : staleDays < 30
                        ? "pending"
                        : "fail";
                return (
                  <tr
                    key={u.id}
                    className={cn(
                      "border-b border-neutral-800/40 transition-colors hover:bg-neutral-900/40",
                      selectedId === u.id && "bg-neutral-900/60",
                    )}
                  >
                    <Td className="font-mono text-[12px] text-neutral-500">
                      {shortId(u.id)}
                    </Td>
                    <Td className="text-neutral-100">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-controls="admin-user-details"
                        aria-expanded={selectedId === u.id}
                        aria-label={`View details for ${u.name ?? u.email}`}
                        onClick={(event) => {
                          detailsTriggerRef.current = event.currentTarget;
                          setSelectedId(u.id);
                        }}
                        className="max-w-[180px] truncate rounded-sm text-left font-medium text-neutral-100 underline-offset-4 transition-colors hover:text-emerald-300 hover:underline focus-visible:outline-none"
                      >
                        {u.name ?? "Unnamed user"}
                      </button>
                    </Td>
                    <Td className="max-w-[220px] truncate text-neutral-400">
                      {u.email}
                    </Td>
                    <Td>
                      {active ? (
                        <Pill tone="emerald">Active</Pill>
                      ) : (
                        <Pill tone="neutral">Idle</Pill>
                      )}
                    </Td>
                    <Td>{tierPill(u.tier)}</Td>
                    <Td className="tabular-nums text-neutral-400">
                      {fmtRelative(u.joinedAt)}
                    </Td>
                    <Td className="text-right font-mono text-[12px] tabular-nums text-neutral-300">
                      {formatTokens(u.balancePoints)}
                    </Td>
                    <Td className="text-right tabular-nums text-neutral-400">
                      {u.chatCount}
                    </Td>
                    <Td
                      className={cn(
                        "text-right tabular-nums",
                        u.revenueDollars > 0
                          ? "text-emerald-300"
                          : "text-neutral-600",
                      )}
                    >
                      {fmtMoney(u.revenueDollars)}
                    </Td>
                    <Td className="text-center">
                      <StatusDot
                        state={u.revenueDollars > 0 ? "ok" : "na"}
                        label={
                          u.revenueDollars > 0
                            ? "Paid account"
                            : "No paid revenue"
                        }
                      />
                    </Td>
                    <Td className="text-center">
                      <StatusDot
                        state={live}
                        label={
                          live === "ok"
                            ? "Active in the last 7 days"
                            : live === "pending"
                              ? "Inactive for 7 to 30 days"
                              : live === "fail"
                                ? "Inactive for more than 30 days"
                                : "Activity unavailable"
                        }
                      />
                    </Td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {selected && (
        <UserDrawer
          user={selected}
          chats={(activity ?? []).filter((c) => c.userId === selected.id)}
          now={now}
          onClose={closeUserDetails}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- user drawer */

function UserDrawer({
  user,
  chats,
  now,
  onClose,
}: {
  user: UserRow;
  chats: Activity;
  now: number | null;
  onClose: () => void;
}) {
  const active =
    now !== null &&
    user.lastActiveAt !== null &&
    now - user.lastActiveAt < ACTIVE_WINDOW;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        id="admin-user-details"
        aria-modal="true"
        showCloseButton={false}
        className="!left-auto !right-0 !top-0 flex h-[100dvh] w-[440px] max-w-[calc(100vw-1rem)] !translate-x-0 !translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 border-l border-neutral-800 bg-neutral-950 p-0 text-neutral-200 sm:max-w-[440px]"
      >
        <div className="flex items-start gap-3 border-b border-neutral-800/70 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neutral-800 text-[14px] font-medium text-neutral-200">
            {(user.name ?? user.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate text-[14px] font-semibold text-neutral-100">
                {user.name ?? user.email}
              </DialogTitle>
              {tierPill(user.tier)}
            </div>
            <DialogDescription className="sr-only">
              User account details and administrative actions for {user.email}.
            </DialogDescription>
            <div className="truncate text-[12px] text-neutral-500">
              {user.email}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10.5px] text-neutral-600">
              <span className="font-mono">ID {shortId(user.id)}</span>
              <span>·</span>
              <span>{active ? "Active" : "Idle"}</span>
            </div>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close user details"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Balance" value={formatTokens(user.balancePoints)} />
            <Metric label="Revenue" value={fmtMoney(user.revenueDollars)} />
            <Metric label="Conversations" value={String(user.chatCount)} />
            <Metric label="Joined" value={fmtDate(user.joinedAt)} />
            <Metric
              label="Last active"
              value={fmtRelative(user.lastActiveAt)}
              wide
            />
          </div>

          <Actions user={user} />

          <div>
            <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
              Recent conversations
            </div>
            <div className="space-y-1">
              {chats.slice(0, 8).map((c) => (
                <div
                  key={c.chatId}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-neutral-900/50"
                >
                  <Chat className="h-3.5 w-3.5 shrink-0 text-neutral-600" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-300">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-neutral-600">
                    {fmtRelative(c.updatedAt)}
                  </span>
                </div>
              ))}
              {chats.length === 0 && (
                <div className="py-6 text-center text-[12px] text-neutral-600">
                  No conversations yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PRESETS = [100_000, 500_000, 1_000_000, 5_000_000];
const presetLabel = (n: number) =>
  n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`;

function Actions({ user }: { user: UserRow }) {
  const grantTokens = useMutation(api.admin.adminGrantTokens);
  const grantSub = useMutation(api.admin.adminGrantSubscription);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
  ) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(
        r.ok
          ? { ok: true, text: okText }
          : { ok: false, text: r.error ?? "Failed." },
      );
    } catch {
      setMsg({ ok: false, text: "Request failed." });
    } finally {
      setBusy(null);
    }
  };

  const grant = (points: number) =>
    run(
      "tok",
      () => grantTokens({ userId: user.id, points }),
      `+${points.toLocaleString()} tokens granted.`,
    );

  const custom = Number(amount);

  return (
    <div className="space-y-4 rounded-lg border border-neutral-800/70 bg-neutral-900/30 p-3.5">
      {/* grant tokens */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
            Grant tokens
          </span>
          <span
            id="admin-token-balance"
            className="font-mono text-[11px] tabular-nums text-neutral-500"
          >
            balance {formatTokens(user.balancePoints)}
          </span>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy !== null}
              onClick={() => grant(p)}
              className="rounded-md border border-neutral-800 px-2 py-1 text-[11.5px] tabular-nums text-neutral-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none disabled:opacity-50"
            >
              +{presetLabel(p)}
            </button>
          ))}
        </div>

        <div>
          <label
            htmlFor="admin-custom-token-amount"
            className="mb-1.5 block text-[11px] font-medium text-neutral-400"
          >
            Custom token amount
          </label>
          <div className="flex items-center gap-2">
            <input
              id="admin-custom-token-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="Enter tokens"
              aria-describedby="admin-token-balance"
              className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-[12.5px] tabular-nums text-neutral-200 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
            <button
              type="button"
              disabled={busy !== null || !(custom > 0)}
              onClick={() => grant(custom)}
              className="shrink-0 rounded-md bg-emerald-500/15 px-3 py-1.5 text-[12px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/25 transition-colors hover:bg-emerald-500/25 focus-visible:outline-none disabled:opacity-40"
            >
              {busy === "tok" ? "Granting…" : "Grant"}
            </button>
          </div>
        </div>
      </div>

      {/* set plan */}
      <div className="flex items-center gap-2 border-t border-neutral-800/60 pt-3">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
          Plan
        </span>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              "pro",
              () => grantSub({ userId: user.id, tier: "pro" }),
              "Set to Pro.",
            )
          }
          className="rounded-md border border-neutral-800 px-2.5 py-1 text-[12px] text-neutral-300 hover:border-neutral-700 hover:text-neutral-100 disabled:opacity-50"
        >
          Pro
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              "max",
              () => grantSub({ userId: user.id, tier: "ultra" }),
              "Set to Max.",
            )
          }
          className="rounded-md border border-neutral-800 px-2.5 py-1 text-[12px] text-neutral-300 hover:border-neutral-700 hover:text-neutral-100 disabled:opacity-50"
        >
          Max
        </button>
      </div>

      {msg && (
        <div
          role={msg.ok ? "status" : "alert"}
          aria-live={msg.ok ? "polite" : "assertive"}
          className={cn(
            "text-[11.5px]",
            msg.ok ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-800/70 bg-neutral-900/30 px-3 py-2.5",
        wide && "col-span-2",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-[13px] tabular-nums text-neutral-100">
        {value}
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-neutral-800 px-3 pb-2.5 pt-1 font-medium",
        className,
      )}
    >
      {children}
    </th>
  );
}

function SortTh({
  label,
  col,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  col: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  align?: "right";
  className?: string;
}) {
  const active = sort?.key === col;
  const ariaSort = active
    ? sort?.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "border-b border-neutral-800 px-3 pb-2.5 pt-1 font-medium",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-label={`${label}: ${active ? `sorted ${ariaSort}` : "not sorted"}`}
        className={cn(
          "group flex w-full items-center gap-1 rounded-sm uppercase tracking-[0.08em] transition-colors hover:text-neutral-300 focus-visible:outline-none",
          align === "right" ? "justify-end" : "justify-start",
          active && "text-neutral-200",
        )}
      >
        {label}
        <Chevron
          className={cn(
            "h-3 w-3 transition",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-40",
            active && sort?.dir === "asc" ? "-rotate-90" : "rotate-90",
          )}
        />
      </button>
    </th>
  );
}

function PlanTh({
  filter,
  onCycle,
  className,
}: {
  filter: PlanFilter;
  onCycle: () => void;
  className?: string;
}) {
  const label =
    filter === "ultra"
      ? "Max"
      : filter === "pro"
        ? "Pro"
        : filter === "free"
          ? "Free"
          : null;
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-neutral-800 px-3 pb-2.5 pt-1 font-medium",
        className,
      )}
    >
      <button
        type="button"
        onClick={onCycle}
        aria-label={
          label
            ? `Filter by plan. Current filter: ${label}.`
            : "Filter by plan. Showing all plans."
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm uppercase tracking-[0.08em] transition-colors hover:text-neutral-300 focus-visible:outline-none",
          filter && "text-neutral-200",
        )}
      >
        Plan
        {label && (
          <span className="rounded px-1 py-px text-[9px] font-medium normal-case text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
            {label}
          </span>
        )}
        <Chevron className="h-3 w-3 rotate-90 opacity-40" />
      </button>
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-3", className)}>{children}</td>;
}
