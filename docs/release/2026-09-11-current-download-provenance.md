# Current downloadable artifact verification

This follows `bc30d07` in `/Users/cetto/RIFT-Release`. That commit passed 619 Jest
suites, 5,485 tests, 24 snapshots and TypeScript; one pre-existing test was skipped.
The working tree was clean, but a post-commit archive check caught a real packaging
drift that those tests alone did not cover.

## Formatting and Local runner provenance

lint-staged/Prettier converted the Local package description's JSON `\u2014`
escape to a literal em dash. JSON meaning stayed the same, but source bytes and
the archive changed. Replacing only that package.json input with its archived
bytes reproduced the old source digest exactly. The archive was regenerated from
the formatted committed source. The pre-commit hook now checks archive freshness
**after** lint-staged and before type checking/tests. It fails instead of allowing
a stale archive to accompany formatted source.

Current Local runner archive SHA-256:
`23079ce79824a4feb479f6f3b06d008b967a846d56d508721ac61dd2e60e3470`.
It contains all seven emitted runtime modules. The previously verified `cc3bef…`
archive had the same program behavior; its package.json encoding differed. The
connect command's compiled cache key must follow the regenerated manifest, so the
production web build is regenerated for this artifact update too.

## Canonical Mac direct build

Built with canonical `packages/desktop/src-tauri/tauri.conf.json`, no Preview
configuration, no debug flag, APP_URL `https://riftsys.app/login`, and isolated
CARGO_TARGET_DIR `/tmp/rift-canonical-desktop-target`. The generated loader's
actual URL was checked before building. Its SHA-256 is
`db53eb5c51dba1f7033db770e061ca1bbae896f4c8a954cab711a78dac0f2448`.
Native input hashes stayed unchanged across the concurrent source commit.

The resulting DMG was mounted read-only, inspected and detached. Verified:

- RIFT, bundle `app.riftsys.desktop`, version 0.1.0, Apple Silicon/arm64 only.
- The four required durable terminal owner/create/read/acknowledge commands.
- Executable SHA-256
  `1400cf5f56c3bb332a93f969bc28f46c1a101e7fd4d8451872d2e0926fb80962`.
- Code-signature verification passed with ad-hoc signing, hardened runtime and
  no TeamIdentifier. **Not notarized; not an Apple-trusted production installer.**

The exact inspected DMG and manifest were copied together to the local public
download directory, replacing the stale artifact. Archive SHA-256:
`fad6444d411c8fa3e13101bd8b90b9745879fa566537e4e0d2829c5908757170`.
The existing download UI already identifies Apple Silicon and discloses pending
Apple verification. No installed application was replaced by this canonical
build; `/Applications/RIFT UI Preview.app` remains the separately verified preview.
No remote deployment, registry publication or notarization was performed.

`pnpm downloads:verify` now passes both the current-source Local archive check and
the read-only mounted DMG content check. This gate verifies content/provenance,
not Gatekeeper acceptance, clean-Mac permissions, updates/rollback or production
web integration. Those remain release requirements.

A read-only codesigning identity query completed successfully and found zero
Developer ID Application identities and zero Apple Distribution identities in
the current keychain search list. No private keys or credentials were exported.

Evidence: `/tmp/rift-current-download-verification.log`,
`/tmp/rift-canonical-desktop-build.log`, `/tmp/rift-canonical-dmg-inspection.json`,
`/tmp/rift-canonical-build-provenance.json`,
`/tmp/rift-canonical-input-sha256.json`, and
`/tmp/rift-verified-download-web-build.log`.
