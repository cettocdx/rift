import {
  getWorkbenchTabNavigationTarget,
  workbenchEditorTabId,
} from "../workbench-editor-tabs";

describe("workbench editor tab navigation", () => {
  it("moves between tabs and wraps at both edges", () => {
    expect(getWorkbenchTabNavigationTarget("ArrowRight", 0, 3)).toBe(1);
    expect(getWorkbenchTabNavigationTarget("ArrowRight", 2, 3)).toBe(0);
    expect(getWorkbenchTabNavigationTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(getWorkbenchTabNavigationTarget("ArrowLeft", 2, 3)).toBe(1);
  });

  it("supports Home and End without reacting to unrelated keys", () => {
    expect(getWorkbenchTabNavigationTarget("Home", 1, 3)).toBe(0);
    expect(getWorkbenchTabNavigationTarget("End", 1, 3)).toBe(2);
    expect(getWorkbenchTabNavigationTarget("Enter", 1, 3)).toBeNull();
    expect(getWorkbenchTabNavigationTarget("ArrowRight", -1, 3)).toBeNull();
    expect(getWorkbenchTabNavigationTarget("ArrowRight", 0, 0)).toBeNull();
  });

  it("creates stable DOM ids for nested and spaced file paths", () => {
    expect(workbenchEditorTabId("src/app shell/page.tsx")).toBe(
      "workbench-editor-tab-src-2Fapp-20shell-2Fpage.tsx",
    );
  });
});
