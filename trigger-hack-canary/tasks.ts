// The shared module also registers agent-long. Both registrations are explicit
// in this profile's allowlist; no scheduled tasks belong in this test worker.
export { agentLongTask } from "../trigger/agent-long";
export { hackLongTask } from "../trigger/hack-long";
