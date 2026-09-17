"use client";

import React, { useEffect } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import dynamic from "next/dynamic";
import { PrimeLanding } from "../components/landing-prime/PrimeLanding";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLaunchFallback } from "@/components/launch/AppLaunchProvider";

const AuthenticatedChat = dynamic(
  () => import("../components/chat").then((module) => module.Chat),
  {
    ssr: false,
    loading: AppLaunchFallback,
  },
);

const AuthenticatedContent = () => {
  const { chatPurpose, initializeNewChat } = useGlobalState();

  // Cross-purpose navigation changes routes before touching the heavy Chat
  // tree. The destination owns its reset so Build never repaints Studio's
  // messages, composer, and preview immediately before unmounting them.
  useEffect(() => {
    if (chatPurpose !== "app") initializeNewChat("app");
  }, [chatPurpose, initializeNewChat]);

  if (chatPurpose !== "app") {
    // One frame, at most, between arriving here and the reset above landing.
    // A centred line of grey text made that frame look like an empty page; the
    // shape of the composer that is about to appear does not.
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center bg-background px-5"
        role="status"
        aria-label="Opening Build"
      >
        <span className="sr-only">Opening workspace…</span>
        <div className="w-full max-w-[680px] space-y-3">
          <Skeleton
            aria-hidden
            className="h-4 w-40 motion-reduce:animate-none"
          />
          <Skeleton
            aria-hidden
            className="h-[104px] w-full rounded-xl motion-reduce:animate-none"
          />
          <div className="flex gap-2">
            <Skeleton
              aria-hidden
              className="h-7 w-24 rounded-md motion-reduce:animate-none"
            />
            <Skeleton
              aria-hidden
              className="h-7 w-32 rounded-md motion-reduce:animate-none"
            />
          </div>
        </div>
      </div>
    );
  }

  return <AuthenticatedChat autoResume={false} />;
};

export default function Page() {
  return (
    <>
      <Authenticated>
        <AuthenticatedContent />
      </Authenticated>
      <Unauthenticated>
        <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
          <PrimeLanding />
        </div>
      </Unauthenticated>
    </>
  );
}
