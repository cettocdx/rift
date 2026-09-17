# Native macOS surface comparison — September 12

Reference: installed Cursor Agents `out/vs/workbench/workbench.glass.main.css`
and `out/main.js` inside `/Applications/Cursor.app/Contents/Resources/app`.

| Theme | Root tint | Sidebar contribution | Chat contribution |
| ----- | --------- | -------------------- | ----------------- |
| Light | white 16% | 42%                  | 84%               |
| Dark  | black 42% | 36%                  | 72%               |

The root CSS paints `--glass-surface-background`. Earlier RIFT work copied
panel weights but substituted the native window's ARGB `#40000000` for the
CSS root surface. That left the captured RIFT planes lighter than Cursor.
RIFT now paints the root surface on the chat route element; body and nested
shells remain clear. The native material is Sidebar/Active in both apps.
Cursor additionally configures native window background #40000000, but the
Electron and WKWebView compositors must not be assumed equivalent: adding
another 25% black layer is not justified by the measured result below.

## Native observations

Native screenshots, captured with the OS helper, not browser mocks:

- Cursor: `codex-shot-2026-09-12_19-25-50.png`: dominant sidebar RGB35,
  empty chat RGB26.
- RIFT before: `codex-shot-2026-09-12_19-26-28.png`: sidebar RGB43 (blue42),
  empty chat RGB29.
- RIFT after: `codex-shot-2026-09-12_19-45-08.png`: sidebar RGB35,
  empty chat RGB25.

Screenshots are in the system temporary directory. Counts were extracted
from original RGB pixels, not resized previews. The result supports a close
match in this dark desktop sample, not universal equivalence across wallpapers,
window positions, color profiles, light theme, or all interactions.

## Automated checks

Four Chromium/WebKit cases verify light/dark computed root and separate panel
fills, explicit high contrast, solid mode, and OS `prefers-contrast: more`.
The OS contrast case failed before the fallback correction and passed after.
These tests do not render NSVisualEffectView. Reduced-transparency media also
uses the opaque native fallback. Mobile behavior remains outside this desktop
media rule.
