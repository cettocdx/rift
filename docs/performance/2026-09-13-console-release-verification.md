# Console release verification — 13 September 2026

Built `packages/console` version 0.3.5 from the current release checkout into a standalone Bun executable for **macOS arm64**. No interactive user installation or stored credentials were changed.

- `node scripts/build-release.mjs`: successful; generated executable SHA-256 `ae12e868cf54870b92b65ef2685b99269d62258cfaedf2001360b6dcc357d6e9`.
- `node scripts/smoke-release.mjs`: passed fresh temporary installation, `--help`, isolated missing-auth `doctor`, update backup, and tampered-executable rejection. The checksum-mismatch error printed during the last probe is the expected rejection; the script exits successfully only if the installed executable remains intact.
- `npm test`: TypeScript build and 56 Node tests passed, none skipped.
- `bun test test/opentui.test.ts`: 11 tests passed, 54 assertions. These include Ctrl+C with an idle draft/open menu, stopping active work and exiting before Stop settles, and streaming-cache behavior.

Logs: `/tmp/rift-console-release-build-20260913.log`, `/tmp/rift-console-release-smoke-20260913.log`, `/tmp/rift-console-node-tests-20260913.log`, `/tmp/rift-console-tui-tests-20260913.log`.

These are offline/package/fixture checks on this Mac. They do not verify live provider latency, cloud recovery, physical-terminal rendering on other platforms, signed/notarized distribution, or parity with another product. The release output is a local generated artifact, not a published release.

The separate downloadable local receiver archive also passed `node scripts/smoke-local-cli.cjs`: fresh isolated dependency installation, help, unauthenticated startup refusal and loading six runtime modules. Runtime probes deny network and child-process execution. Optional native PTY dependencies were deliberately omitted, so this probe does not verify interactive PTYs or an authenticated receiver connection. Log: `/tmp/rift-local-receiver-smoke-20260913.log`.

## Separate desktop download finding

`node scripts/verify-desktop-download.cjs` passed its existing archive/content checks for `RIFT-mac.dmg` (`fad6444d411c8fa3e13101bd8b90b9745879fa566537e4e0d2829c5908757170`). That is **not evidence that the download contains the latest desktop source**. Its manifest names source revision `bc30d07a55480acaa83ea842e31304c1b54b07fb`; comparing that revision with current HEAD `0b9d3f6` shows six changed desktop files, including Rust window chrome, bridge permissions, Cargo settings and Tauri configuration. The current verifier checks archive identity, binary hashes and a small required-command list, but does not compare source revision/build-input freshness.

Before publishing downloads, rebuild the canonical desktop package from the reviewed release source, regenerate provenance and strengthen freshness validation. The current package is also explicitly ad-hoc signed and not notarized. Log: `/tmp/rift-desktop-download-check-20260913.log`. It was mounted read-only for inspection; no app was installed or launched.
