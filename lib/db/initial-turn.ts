import "server-only";
import type { UIMessagePart } from "ai";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { AgentRunClaimLostError } from "@/lib/api/agent-run-claims";
import { ChatSDKError } from "@/lib/errors";
import { extractFileIdsFromParts } from "@/lib/utils/file-token-utils";
import { getConvexClient, getConvexServiceKey } from "./convex-client";
import { sanitizeForConvexValue } from "./convex-value-sanitizer";

/** Agent-long only; ordinary chat persistence does not require startup claims. */
export async function persistClaimedInitialTurn(
  args: {
    chatId: string;
    userId: string;
    claimId: string;
    chat: { user_id: string } | null;
    messages: { id: string; parts: UIMessagePart<any, any>[] }[];
    regenerate?: boolean;
    isHidden?: boolean;
    purpose?: string;
    projectId?: Id<"projects">;
  },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AgentRunClaimLostError();
  if (args.chat && args.chat.user_id !== args.userId)
    throw new ChatSDKError(
      "forbidden:chat",
      "You don't have permission to access this chat",
    );
  const last = args.messages.at(-1);
  const firstPart = last?.parts?.[0];
  const title = (
    firstPart?.type === "text" && firstPart.text ? firstPart.text : "New Chat"
  ).substring(0, 100);
  const parts =
    last && !args.regenerate
      ? (sanitizeForConvexValue(last.parts) as UIMessagePart<any, any>[])
      : undefined;
  const fileIds = parts
    ? Array.from(new Set(extractFileIdsFromParts(parts)))
    : [];
  try {
    await getConvexClient().mutation(api.agentRunClaims.persistInitialTurn, {
      serviceKey: getConvexServiceKey()!,
      userId: args.userId,
      chatId: args.chatId,
      claimId: args.claimId,
      allowCreate: args.chat === null,
      title,
      purpose: args.purpose,
      projectId: args.projectId,
      message:
        last && parts
          ? {
              id: last.id,
              parts,
              fileIds: fileIds.length ? (fileIds as Id<"files">[]) : undefined,
              isHidden: args.isHidden,
            }
          : undefined,
    });
  } catch (error) {
    const data =
      error && typeof error === "object" && "data" in error
        ? error.data
        : undefined;
    if (
      data &&
      typeof data === "object" &&
      "code" in data &&
      data.code === "AGENT_RUN_LOST"
    )
      throw new AgentRunClaimLostError();
    throw error;
  }
  // A response may race cancellation. The route also keeps its independent
  // final current-claim check immediately before Trigger dispatch.
  if (signal?.aborted) throw new AgentRunClaimLostError();
}
