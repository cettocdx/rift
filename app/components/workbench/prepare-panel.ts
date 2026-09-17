type PanelKind = "activity" | "terminal" | "browser" | "preview";
const prepared = new Map<PanelKind, Promise<unknown>>();

/** Download the shell and requested view together on pointer/keyboard intent.
 * Importing does not mount the panel, connect a PTY, or submit an agent task.
 * Failed warmups are retryable and never surface as unhandled rejections.
 */
export function prepareWorkbenchPanel(kind: PanelKind) {
  if (prepared.has(kind)) return;
  const view = {
    activity: () => import("../AgentActivityPanel"),
    terminal: () => import("../terminal/TerminalDock"),
    browser: () => import("./WorkbenchBrowser"),
    preview: () => import("../BuildPreviewPanel"),
  };
  const pending = Promise.all([import("./WorkbenchDock"), view[kind]()]);
  prepared.set(kind, pending);
  void pending.catch(() => prepared.delete(kind));
}
