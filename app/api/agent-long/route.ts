import { createAgentLongHandler } from "@/lib/api/agent-long-handler";

export const maxDuration = 30;
export const POST = createAgentLongHandler(false);
