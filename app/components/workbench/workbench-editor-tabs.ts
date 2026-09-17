export type WorkbenchTabNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

/**
 * Implements the WAI-ARIA tabs keyboard model with wrap-around navigation.
 * Selection follows focus, matching native IDE file tabs.
 */
export function getWorkbenchTabNavigationTarget(
  key: string,
  currentIndex: number,
  tabCount: number,
): number | null {
  if (tabCount <= 0 || currentIndex < 0 || currentIndex >= tabCount) {
    return null;
  }

  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowLeft") {
    return (currentIndex - 1 + tabCount) % tabCount;
  }
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  return null;
}

export function workbenchEditorTabId(path: string): string {
  return `workbench-editor-tab-${encodeURIComponent(path).replaceAll("%", "-")}`;
}
