// Open the Operation Launcher modal from anywhere (sidebar Arsenal, or the
// "next step" suggestions in operation mode). A single launcher instance lives
// in ChatLayout and subscribes to these requests. Mirrors the settings-dialog
// event pattern.

const EVENT_NAME = "rift:open-operation-launcher";

export interface OpenLauncherDetail {
  operationId: string;
  /** Pre-fill the operation's primary target field (for chained ops). */
  initialTarget?: string;
}

export function openOperationLauncher(detail: OpenLauncherDetail) {
  window.dispatchEvent(
    new CustomEvent<OpenLauncherDetail>(EVENT_NAME, { detail }),
  );
}

export function onOpenOperationLauncher(
  callback: (detail: OpenLauncherDetail) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<OpenLauncherDetail>).detail;
    if (detail) callback(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
