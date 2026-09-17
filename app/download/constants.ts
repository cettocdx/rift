// The macOS direct build is intentionally available before notarization. Keep
// the UI disclosure and first-launch guidance in sync with this status. The
// stale Windows installer stays unavailable until a current build exists.
export const downloadLinks = {
  macos: "/downloads/RIFT-mac.dmg",
  windows: null,
} as const;

export const desktopReleaseStatus = {
  macos: "Unsigned direct build. Apple verification pending.",
  windows: "Signed current build pending",
};
