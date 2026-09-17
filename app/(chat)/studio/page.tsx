"use client";

import { useEffect } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import dynamic from "next/dynamic";
import { LandingPage } from "@/app/components/landing/LandingPage";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { StudioLoading } from "@/app/components/studio/StudioLoading";

const AuthenticatedChat = dynamic(
  () => import("@/app/components/chat").then((module) => module.Chat),
  {
    ssr: false,
    loading: () => <StudioLoading />,
  },
);

function StudioChat() {
  const { chatPurpose, initializeNewChat } = useGlobalState();

  // `/studio` is a real deep link, so it must select the image/video execution
  // path even when it is opened directly or restored by the browser. Keep Chat
  // unmounted until that state is ready to avoid a one-frame Build UI flash.
  useEffect(() => {
    if (chatPurpose !== "image") {
      initializeNewChat("image");
    }
  }, [chatPurpose, initializeNewChat]);

  if (chatPurpose !== "image") {
    return <StudioLoading />;
  }

  return <AuthenticatedChat autoResume={false} />;
}

export default function StudioAppPage() {
  return (
    <>
      <Authenticated>
        <StudioChat />
      </Authenticated>
      <Unauthenticated>
        <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
          <LandingPage authReturnPath="/studio" />
        </div>
      </Unauthenticated>
    </>
  );
}
