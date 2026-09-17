# RIFT Logo Package 11 rollout

Approved originals are checked in under `public/brand/Rift-*.svg`; `package-11.json` records their SHA-256 hashes. These files are byte-identical to the supplied package. The symbol, outlined lettering, horizontal and stacked compositions use the supplied geometry and clear space. No replacement typeface is required.

## Shared UI

`lib/brand/logo.ts` holds the exact paths and transforms. `RiftLogo`, `RiftWordmark` and `RiftBrandLockup` render them. Legacy `RIFTSVG`, pixel-mark and effort-mark APIs delegate to the same symbol. Chat activity, reasoning controls, login, navigation, Hack Workbench and landing variants share the artwork. Active marks pulse opacity and respect reduced motion.

## Regeneration

- Web/PWA/favicon/social assets: `node scripts/sync-rift-brand.cjs`.
- Native icons in both Tauri roots: `node packages/desktop/scripts/generate-icons.mjs`; verify with `--check`.
- Staged landing screenshots and scene reel: `node scripts/product-capture/capture.cjs`. They are visibly labeled staged demos and make no live model calls.
- CLI builds: run `build:release` in `packages/console`. The terminal renders a uniformly scaled Braille approximation of the same vector; terminal character cells cannot preserve vector pixels exactly.

Existing public social asset URLs remain supported with the new artwork. Third-party provider/plugin marks and abstract product photography remain their respective assets. Old screenshots in historical work logs are evidence, not current product branding.

## Verification

React symbol, wordmark and horizontal composition are raster-compared against the original SVGs at the same viewport. Native tests check hashes, every PNG density/size, and launcher transforms. Capture manifests record all generated asset hashes. Installed applications and downloadable bundles require rebuilding after icon changes; source checks alone do not update those binaries.

## Rollout checks (2026-09-13)

- Source originals: all ten SVGs match the supplied package byte-for-byte.
- Isolated browser audit: 16 Chromium/WebKit combinations, light/dark, widths 320/390/768/1280; SVG ratios, path bounds, header visibility and reduced-motion checks passed.
- Console: 60 Node and 13 OpenTUI tests passed, installer smoke passed, installed executable checked offline with no model request; 26 existing configuration/session files retained.
- Standalone HTML/PDF report cover now embeds the canonical horizontal SVG.
- Final Next production compilation and TypeScript checks passed. The shared terminal artwork has no cross-runtime imports; generated Braille cells have vector-parity tests.

Historical screenshots and executable backups remain historical evidence. The separate old Electron experiment is not a supported release target in this checkout; canonical desktop distribution is built from `packages/desktop`.
