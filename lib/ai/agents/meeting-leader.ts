import type { CustomAgentProfileConfig } from "./pet-roster";
import { READ_ONLY_AGENT_BASE_TOOL_IDS } from "./read-only-tools";

export const MEETING_LEADER_ERROR =
  "Choose a bot with delegation enabled as the first participant.";

/** Use the runtime's permission ceiling rather than granting meeting-only tools. */
export function canLeadProjectMeeting(
  profile:
    | Pick<CustomAgentProfileConfig, "enabled" | "toolIds" | "permissionPreset">
    | null
    | undefined,
): boolean {
  if (!profile?.enabled || !profile.toolIds.includes("delegate_task"))
    return false;
  return (
    profile.permissionPreset !== "read-only" ||
    READ_ONLY_AGENT_BASE_TOOL_IDS.has("delegate_task")
  );
}
