"use client";

import {
  useQuery,
  Authenticated,
  Unauthenticated,
  AuthLoading,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatTokens } from "@/lib/billing/token-display";
import { RiftWordmark } from "@/components/icons/rift-wordmark";

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Loading…
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-center">
      <RiftWordmark height={16} className="text-foreground" />
      <p className="text-sm text-muted-foreground">
        Not authorized. This page is for admins only.
      </p>
    </div>
  );
}

/**
 * Gate the dashboard on auth state — mirrors the rest of the app — so the
 * stats query only runs once the user is authenticated. Running it before auth
 * resolves makes it return null (not authorized) on the first paint.
 */
export default function AdminPage() {
  return (
    <>
      <AuthLoading>
        <LoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        <NotAuthorized />
      </Unauthenticated>
      <Authenticated>
        <AdminDashboard />
      </Authenticated>
    </>
  );
}

function AdminDashboard() {
  const stats = useQuery(api.admin.getAdminStats);

  if (stats === undefined) {
    return <LoadingScreen />;
  }

  if (stats === null) {
    return <NotAuthorized />;
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <RiftWordmark height={16} className="text-foreground" />
          <span className="text-sm text-muted-foreground">Admin</span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Users" value={stats.totalUsers.toLocaleString()} />
          <StatCard
            label="Revenue"
            value={`$${stats.totalRevenueDollars.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            })}`}
          />
          <StatCard
            label="Active (7d)"
            value={stats.activeLast7Days.toLocaleString()}
          />
          <StatCard label="Chats" value={stats.totalChats.toLocaleString()} />
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Balance</th>
                <th className="px-4 py-3 font-medium text-right">Spent</th>
                <th className="px-4 py-3 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.users.map((u) => (
                <tr key={u.id} className="hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{u.email}</div>
                    {u.name ? (
                      <div className="text-xs text-muted-foreground">
                        {u.name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(u.joinedAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatTokens(u.balancePoints)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {u.revenueDollars > 0
                      ? `$${u.revenueDollars.toLocaleString("en-US", {
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(u.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Showing {stats.users.length} user
          {stats.users.length === 1 ? "" : "s"}. Balance is in RIFT tokens;
          spent is lifetime gross revenue.
        </p>
      </div>
    </div>
  );
}
