"use client";

import { Chat } from "../../../components/chat";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";
import { use } from "react";

export function ConversationRoute({ chatId }: { chatId: string }) {
  return (
    <ProtectedPageBoundary resource="this conversation">
      <Chat key={chatId} autoResume={true} />
    </ProtectedPageBoundary>
  );
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <ConversationRoute chatId={params.id} />;
}
