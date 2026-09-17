import { createAgentLongTask } from "./agent-long";

// Separate registration keeps the agent-only canary free of Hack tasks.
export const hackLongTask = createAgentLongTask("hack-long");
