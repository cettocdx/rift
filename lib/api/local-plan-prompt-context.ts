import { ChatSDKError } from "@/lib/errors";
import type { ChatMode, ChatPurpose, SandboxPreference } from "@/types/chat";

/** Resolve only metadata for Local Plan. No tool invocation or Cloud boot. */
export async function getLocalPlanPromptContext({
  mode,
  purpose,
  preference,
  manager,
  onUnavailable,
}: {
  mode: ChatMode;
  purpose: ChatPurpose;
  preference?: SandboxPreference;
  manager: object;
  onUnavailable: (error: ChatSDKError) => Promise<void>;
}): Promise<string | null> {
  if (
    purpose !== "app" ||
    mode !== "ask" ||
    !preference ||
    preference === "e2b" ||
    preference === "desktop"
  )
    return null;
  try {
    if (
      !("getReadOnlySandboxContextForPrompt" in manager) ||
      typeof manager.getReadOnlySandboxContextForPrompt !== "function"
    ) {
      throw new Error("Local Plan context is unsupported");
    }
    return await manager.getReadOnlySandboxContextForPrompt();
  } catch {
    const error = new ChatSDKError(
      "bad_request:stream",
      "The selected local runner is unavailable. Reconnect it and try again.",
    );
    // createUIMessageStream catches execute failures internally. Its caller
    // must refund pre-model deductions/finish the run before surfacing this.
    await onUnavailable(error);
    throw error;
  }
}
