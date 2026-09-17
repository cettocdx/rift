import { ChatSDKError } from "@/lib/errors";
import { getUserFriendlyProviderError } from "@/lib/utils/error-utils";
import type { ChatLogger } from "./chat-logger";

/** Merged stream failures happen after the HTTP handler has returned. */
export function createChatStreamErrorHandler(
  logger: Pick<ChatLogger, "emitChatError" | "emitUnexpectedError">,
) {
  return (error: unknown): string => {
    if (error instanceof ChatSDKError) {
      logger.emitChatError(error);
      return typeof error.cause === "string" ? error.cause : error.message;
    }
    logger.emitUnexpectedError(error);
    return getUserFriendlyProviderError(error);
  };
}
