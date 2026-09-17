"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { TaskCenter } from "@/app/components/tasks/TaskCenter";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedPageSignIn } from "@/app/components/page-shell/ProtectedPageSignIn";

function TasksLoading() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background px-5 py-5 md:px-7"
      role="status"
      aria-label="Loading tasks"
    >
      <span className="sr-only">Loading tasks…</span>
      <Skeleton aria-hidden className="h-6 w-28 motion-reduce:animate-none" />
      <Skeleton
        aria-hidden
        className="mt-3 h-4 w-80 max-w-full motion-reduce:animate-none"
      />
      <Skeleton
        aria-hidden
        className="mt-8 h-72 w-full rounded-md motion-reduce:animate-none"
      />
    </div>
  );
}

export default function TasksPage() {
  return (
    <>
      <AuthLoading>
        <TasksLoading />
      </AuthLoading>
      <Authenticated>
        <TaskCenter />
      </Authenticated>
      <Unauthenticated>
        <ProtectedPageSignIn resource="tasks" />
      </Unauthenticated>
    </>
  );
}
