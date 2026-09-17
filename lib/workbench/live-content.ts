import type { SidebarContent } from "@/types/chat";

export function resolveLiveSidebarContent(
  selected: SidebarContent | null,
  live: SidebarContent | null,
): SidebarContent | null {
  if (
    !selected ||
    !live ||
    !("toolCallId" in selected) ||
    !("toolCallId" in live)
  )
    return selected;
  return typeof selected.toolCallId === "string" &&
    selected.toolCallId === live.toolCallId
    ? live
    : selected;
}
