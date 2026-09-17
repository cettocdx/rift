"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Drop-in replacement for the previous auth hook, backed by
 * Convex Auth. Returns the same `{ user, loading, entitlements }` shape the
 * app's components already consume.
 *
 * `user` exposes id/email/firstName/lastName/profilePictureUrl derived from the
 * Convex Auth users table (which stores a single `name` + `image`).
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
  name: string | null;
}

export function useAuth(): {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  entitlements: string[];
  /** False while Convex has not resolved the entitlement query yet. */
  entitlementsReady: boolean;
} {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  // Entitlement slugs derived from the user's active LemonSqueezy subscription
  // (Pro/Max). Empty = free tier. resolveSubscriptionTier maps these to a tier.
  const entitlements = useQuery(
    api.subscriptions.getMyEntitlements,
    isAuthenticated ? {} : "skip",
  );

  const loading = isLoading || (isAuthenticated && viewer === undefined);
  const entitlementsReady =
    !isLoading && (!isAuthenticated || entitlements !== undefined);

  let user: AuthUser | null = null;
  if (viewer) {
    const name = viewer.name ?? "";
    const parts = name.split(" ").filter(Boolean);
    user = {
      id: viewer._id,
      email: viewer.email ?? "",
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
      profilePictureUrl: viewer.image ?? null,
      name: name || null,
    };
  }

  return {
    user,
    loading,
    isAuthenticated,
    entitlements: entitlements ?? [],
    entitlementsReady,
  };
}
