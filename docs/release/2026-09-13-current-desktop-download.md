# Canonical desktop download freshness — 13 September 2026

The previous public DMG passed byte/identity verification but was built from `bc30d07a55480acaa83ea842e31304c1b54b07fb`. Six desktop files had changed since that revision. Self-consistency did not establish source freshness.

## Fix and current package

`verify-desktop-download.cjs` now compares a deterministic digest of current canonical native and shared launcher build inputs with the package manifest. It includes Rust source/lock/config, capabilities, permissions, icons, shared launch CSS/logo/runtime, dependency manifests, optional Cargo and macOS configuration, optional Info.plist, and any sibling frontend assets. Only generated `src/index.html` is excluded from frontend assets; its actual source inputs are included. Rust target output and unrelated web components do not invalidate the native package. Missing required files and symlinked input paths fail closed.

The gate also checks actual mounted ARM64 architecture and runs strict deep code-signature verification, in addition to the existing identity, version, executable hash and bounded terminal command checks.

The canonical build used production APP_URL `https://riftsys.app/login`, the default desktop Tauri config, `--bundles dmg`, and isolated `CARGO_TARGET_DIR=/tmp/rift-canonical-desktop-target`. The 98 input files had identical digests before and after compilation. The generated launcher matched an independent render using the canonical production URL. The new DMG was mounted read-only, inspected, detached, and verified in a staging directory before replacing the local `public/downloads` pair.

- Source revision: `94e41d125fde154d3285622ce35219064653ce67` (native/shared launch inputs unchanged during build).
- Native input digest: `ae5783964aaa01153755313a3f4a4dc95ec1b422c23d73fc83c3a202c83edb99`.
- DMG SHA-256: `fd4638f98de374b0c963aca0feaf6c440ae3d572ef98c699486300948bbc724f`.
- Executable SHA-256: `e2671cc678af3f5d1d647ca6fcaf6ea3feaaf944d6fbe789b40f610286fd6589`.
- Bundle: `RIFT`, `app.riftsys.desktop`, version `0.1.0`, ARM64.

## Verification and limits

The new stale-input and bundled-asset regression tests first failed against the old gate, then passed after the fixes. Nineteen focused desktop gate, loader, startup lifecycle and launch layout tests passed. The old public archive was explicitly rejected by the strengthened gate before the replacement was staged; the replacement passed real DMG verification. A full HTTP download from `http://localhost:3020/downloads/RIFT-mac.dmg` returned 200, 3,084,312 bytes, and the exact verified archive SHA-256; the running local preview serves the new package without a web-server restart.

This is a local download artifact update, not a remote deployment or clean-Mac installation test. The installed RIFT UI Preview application was not replaced. The package has an ad-hoc signature and is **not notarized**; compilation explicitly reported missing Apple notarization credentials. It is not yet an Apple-trusted public distribution. The input digest is a build freshness check, not a cryptographically signed build attestation or a guarantee that the remotely loaded web application matches the native revision.

Evidence:

- `/tmp/rift-canonical-desktop-build-20260913.log`
- `/tmp/rift-desktop-inputs-before.json`
- `/tmp/rift-canonical-download-inspection-20260913.json`
