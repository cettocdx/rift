import { isTauriEnvironment } from "@/app/hooks/useTauri";

export type DesktopTerminalOwner = { ownerId: string; ownerGeneration: number };
export const DESKTOP_TERMINAL_OWNER_CHANGED_EVENT =
  "rift:desktop-terminal-owner-changed";
export const DESKTOP_TERMINAL_OWNER_READY_EVENT =
  "rift:desktop-terminal-owner-ready";
function notifyOwnerChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT));
}
let revision = 0;
let activeOwner: DesktopTerminalOwner | null = null;
let ownerId: string | null = null;
let pending: Promise<DesktopTerminalOwner> | null = null;

/** Called only for resolved authentication, never for the hydration gap. */
export function synchronizeDesktopTerminalOwner(
  id: string,
): Promise<DesktopTerminalOwner> {
  if (ownerId === id && pending) return pending;
  const requestedRevision = ++revision;
  ownerId = id;
  activeOwner = null;
  pending = (async () => {
    if (!isTauriEnvironment())
      throw new Error("Desktop terminal is unavailable.");
    const { invoke } = await import("@tauri-apps/api/core");
    if (requestedRevision !== revision)
      throw new Error("Desktop terminal ownership changed.");
    let ownerGeneration: number;
    try {
      ownerGeneration = await invoke<number>(
        "synchronize_desktop_terminal_owner",
        { ownerId: id },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : error;
      if (
        message === "Command synchronize_desktop_terminal_owner not found" ||
        message ===
          "synchronize_desktop_terminal_owner not allowed. Command not found"
      ) {
        throw new Error(
          "Update RIFT Desktop to use durable terminal sessions.",
        );
      }
      throw error;
    }
    if (requestedRevision !== revision)
      throw new Error("Desktop terminal ownership changed.");
    if (!Number.isSafeInteger(ownerGeneration) || ownerGeneration < 0)
      throw new Error("Invalid desktop terminal ownership.");
    activeOwner = { ownerId: id, ownerGeneration };
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(DESKTOP_TERMINAL_OWNER_READY_EVENT));
    return activeOwner;
  })().catch((error) => {
    // Failed imports/IPC are retryable; only this attempt may clear its slot.
    if (requestedRevision === revision) pending = null;
    throw error;
  });
  // Consumers still receive the rejection; the auth observer need not retain it.
  void pending.catch(() => {});
  notifyOwnerChange();
  return pending;
}

/** Synchronously invalidates imports/requests that have not reached native IPC. */
export function invalidateDesktopTerminalOwner(): void {
  revision += 1;
  ownerId = null;
  activeOwner = null;
  pending = null;
  notifyOwnerChange();
}

export async function requireDesktopTerminalOwner(): Promise<DesktopTerminalOwner> {
  const request =
    pending ?? (ownerId ? synchronizeDesktopTerminalOwner(ownerId) : null);
  if (!request) throw new Error("Sign in before opening a desktop terminal.");
  const result = await request;
  if (request !== pending)
    throw new Error("Desktop terminal ownership changed.");
  return result;
}

export function isCurrentDesktopTerminalOwner(
  owner: DesktopTerminalOwner,
): boolean {
  return activeOwner === owner;
}
