import type { Id } from "@/convex/_generated/dataModel";
import type { ActiveProjectContext } from "@/types/chat";
import { coerceChatPurpose } from "@/types/chat";

/** Rehydrate the optimistic client binding from an ownership-filtered chat. */
export function projectContextFromChat(chat: {
  project_id?: Id<"projects">;
  purpose?: string;
}): ActiveProjectContext | null {
  if (!chat.project_id) return null;
  return {
    id: chat.project_id,
    type: coerceChatPurpose(chat.purpose),
  };
}
