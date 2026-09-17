# Native RIFT icons

`RIFT.svg` is the exact approved `SVG/Rift-AppIcon-Light.svg` from RIFT Logo Package 11. `RIFT-mark.svg` is its approved black symbol, used by Android adaptive/monochrome launchers. Both sources are pinned by SHA-256 in the generator and are identical to the matching canonical files in `public/brand`.

From the repository root:

```sh
node packages/desktop/scripts/generate-icons.mjs
node packages/desktop/scripts/generate-icons.mjs --check
node --test packages/desktop/scripts/icon-assets.test.cjs
```

The generator uses the installed Tauri icon tool for PNG, ICO, ICNS, Windows, Android and iOS families, then Sharp for the source macOS iconset. Android adaptive icons use the symbol on the package's `#F3F0E8` background; iOS icons flatten onto that same color. Tauri CLI 2.11.2 emits 49px legacy/round Android hdpi images; the generator derives the required 72px versions from its largest matching outputs, retaining its launcher masks. ICNS chunks are sorted by type without re-encoding to remove nondeterministic container ordering from the Tauri encoder. Both this directory and the legacy `src-tauri/icons` mirror receive the same artifacts. `provenance.json` records source hashes, generator versions and each artifact's hash/dimensions. `--check` regenerates into a temporary directory and compares all artifacts without writing repository files.

The offline native launch screen reads the canonical `public/brand/Rift-Symbol-Black.svg`. Its builder preserves nested group and path transforms and uses `currentColor` for the light/dark launch theme. Regenerate only the offline HTML with `node packages/desktop/scripts/build.js`.

Generating icons does not rebuild or update installed applications, cached release bundles or downloadable installers. Those must be rebuilt and verified separately; replacing resources inside an already signed application is not part of this script.

## Apple Icon Composer override

For macOS, run `node packages/desktop/scripts/generate-apple-icon.mjs` after the legacy cross-platform generator. It compiles the canonical iOS `RIFTIcon.icon` document using Apple actool and replaces `icon.icns` plus `Assets.car` in both desktop roots. macOS bundles reference `CFBundleIconName=RIFTIcon`. Legacy `--check` only describes the earlier flat artwork and is not the acceptance check for these Composer outputs.
