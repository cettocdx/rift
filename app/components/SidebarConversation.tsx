import ChatItem from "./ChatItem";
import type { Doc } from "@/convex/_generated/dataModel";
import type { ConversationStatus } from "@/lib/ui/conversation-status";

export type SidebarConversationRecord = Doc<"chats"> & {
  branched_from_title?: string;
  sidebarStatus?: ConversationStatus;
};
export function SidebarConversation({
  chat,
}: {
  chat: SidebarConversationRecord;
}) {
  return (
    <ChatItem
      id={chat.id}
      title={chat.title}
      isBranched={!!chat.branched_from_chat_id}
      branchedFromTitle={chat.branched_from_title}
      shareId={chat.share_id}
      shareDate={chat.share_date}
      isPinned={chat.pinned_at != null}
      isStreaming={chat.sidebarStatus === "running"}
      status={chat.sidebarStatus}
    />
  );
}
