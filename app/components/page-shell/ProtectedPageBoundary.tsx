"use client";

import type { ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePageErrorBoundary } from "./WorkspacePageErrorBoundary";
import { ProtectedPageSignIn } from "./ProtectedPageSignIn";

function ProtectedPageLoading() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background px-5 py-5 md:px-7"
      role="status"
      aria-label="Loading workspace"
    >
      <span className="sr-only">Loading workspace…</span>
      <Skeleton aria-hidden className="h-6 w-32 motion-reduce:animate-none" />
      <Skeleton
        aria-hidden
        className="mt-3 h-4 w-96 max-w-full motion-reduce:animate-none"
      />
      <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            aria-hidden
            className="h-28 rounded-md motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

export function ProtectedPageBoundary({
  children,
  resource,
}: {
  children: ReactNode;
  resource: string;
}) {
  return (
    <>
      <AuthLoading>
        <ProtectedPageLoading />
      </AuthLoading>
      <Authenticated>
        <WorkspacePageErrorBoundary key={resource} resource={resource}>
          {children}
        </WorkspacePageErrorBoundary>
      </Authenticated>
      <Unauthenticated>
        <ProtectedPageSignIn resource={resource} />
      </Unauthenticated>
    </>
  );
}
