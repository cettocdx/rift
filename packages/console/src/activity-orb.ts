import { terminalLogo } from "./terminal-logo.js";

/** Preserve the approved silhouette; activity changes brightness, never shape. */
export const RIFT_ACTIVITY_MARK = terminalLogo("symbol", 6, 3);
export const RIFT_ACTIVITY_FRAME_MS = 80;

export function riftActivityIntensity(
  elapsedMs: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return 238;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return Math.round(
    190 + (65 * (1 - Math.cos((elapsed / 1600) * Math.PI * 2))) / 2,
  );
}
