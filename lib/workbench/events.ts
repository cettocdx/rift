export const OPEN_AGENT_ACTIVITY_EVENT = "rift:open-agent-activity";
export const OPEN_WORKBENCH_EVENT = "rift:open-workbench";
export const HIDE_WORKBENCH_EVENT = "rift:hide-workbench";
export const MAXIMIZE_WORKBENCH_EVENT = "rift:maximize-workbench";

export interface OpenAgentActivityDetail {
  toolCallId?: string;
}

export interface OpenWorkbenchDetail {
  kind: "browser" | "terminal" | "files" | "activity" | "preview" | "review";
}

declare global {
  interface WindowEventMap {
    "rift:open-agent-activity": CustomEvent<OpenAgentActivityDetail>;
    "rift:open-workbench": CustomEvent<OpenWorkbenchDetail>;
    "rift:hide-workbench": CustomEvent<void>;
    "rift:maximize-workbench": CustomEvent<void>;
  }
}

export function openAgentActivity(detail: OpenAgentActivityDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_AGENT_ACTIVITY_EVENT, { detail }));
}

export function openWorkbench(detail: OpenWorkbenchDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_WORKBENCH_EVENT, { detail }));
}

export function hideWorkbench(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HIDE_WORKBENCH_EVENT));
}

export function maximizeWorkbench(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAXIMIZE_WORKBENCH_EVENT));
}
