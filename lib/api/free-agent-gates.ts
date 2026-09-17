import type { ChatMode, SubscriptionTier, SandboxPreference } from "@/types";

/**
 * Compatibility entry point: account authorization is enforced by admission.
 * Keep this leaf free of model, tokenizer and sandbox runtime imports.
 */
export function assertFreeAgentGates(_args: {
  mode: ChatMode;
  subscription: SubscriptionTier;
  sandboxPreference: SandboxPreference | undefined;
  rawSelectedModel: string | undefined;
}): void {
  // Subscription tiers were removed: every signed-in user can run cloud (E2B)
  // Agent mode with any model, so there are no free-tier agent gates anymore.
}
