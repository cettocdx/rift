import type { SandboxPreference } from "@/types/chat";

/** A connected database row is not a live receiver. Token refresh updates
 * lastSeen; omit expired registrations and offer the freshest receiver first.
 * Execution still verifies socket presence before sending any command. */
export function availableLocalRunners<
  T extends {
    lastSeen: number;
    isDesktop: boolean;
    capabilities: { commands: boolean };
  },
>(connections: readonly T[], now = Date.now()): T[] {
  return connections
    .filter(
      (connection) =>
        !connection.isDesktop &&
        connection.capabilities.commands &&
        Number.isFinite(connection.lastSeen) &&
        // Relay tokens last one hour; allow five minutes for refresh/reconnect.
        now - connection.lastSeen < 65 * 60 * 1000,
    )
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Reopening a chat must never move its work to a different computer. */
export function restoreExecutionTarget(
  stored: string | null | undefined,
  current: SandboxPreference,
  justCreated: boolean,
): SandboxPreference {
  if (!stored) return justCreated ? current : "e2b";
  return stored === "tauri" ? "desktop" : stored;
}

export function isExecutionTargetAvailable(
  target: SandboxPreference,
  connections: ReadonlyArray<{
    connectionId: string;
    isDesktop: boolean;
    capabilities: { commands: boolean };
  }>,
): boolean {
  return (
    target === "e2b" ||
    connections.some(
      (connection) =>
        connection.capabilities.commands &&
        (target === "desktop"
          ? connection.isDesktop
          : connection.connectionId === target),
    )
  );
}
