import { createChatHandler } from "@/lib/api/chat-handler";

export const runtime = "nodejs";
export const maxDuration = 420;
export const HACK_AGENT_PREEMPTIVE_TIMEOUT_MS = 370_000;
export const HACK_AGENT_REPORTING_RESERVE_MS = 45_000;

// Hacker Mode gets an isolated US-region canary route. The regular chat API
// stays on the project's Dublin default, while this handler can try Grok 4.5
// and safely fall back to Grok 4.3 if xAI still rejects the regional route.
export const POST = createChatHandler({
  grok45Canary: true,
  hackWorkbenchOnly: true,
  forcedPurpose: "security",
  agentPreemptiveTimeoutMs: HACK_AGENT_PREEMPTIVE_TIMEOUT_MS,
  agentReportingReserveMs: HACK_AGENT_REPORTING_RESERVE_MS,
  preemptiveTimeoutEndpoint: "/api/hack-chat",
});
