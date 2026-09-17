"use client";

import { use, useEffect } from "react";
import { Chat } from "@/app/components/chat";
import Loading from "@/components/ui/loading";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

function StudioConversation({ chatId }: { chatId: string }) {
  const { chatPurpose, setChatPurpose } = useGlobalState();

  useEffect(() => {
    if (chatPurpose !== "image") setChatPurpose("image");
  }, [chatPurpose, setChatPurpose]);

  if (chatPurpose !== "image") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center bg-background"
        role="status"
        aria-label="Opening Studio conversation"
      >
        <Loading />
      </div>
    );
  }

  return <Chat key={chatId} autoResume={true} />;
}

export function StudioConversationRoute({ chatId }: { chatId: string }) {
  return (
    <ProtectedPageBoundary resource="this Studio conversation">
      <StudioConversation chatId={chatId} />
    </ProtectedPageBoundary>
  );
}

export default function StudioChatPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = use(props.params);
  return <StudioConversationRoute chatId={params.id} />;
}
