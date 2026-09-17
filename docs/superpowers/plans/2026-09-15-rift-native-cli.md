# Native RIFT Terminal Installation Plan

**Goal:** `rift` opens the packaged native Codex TUI in the current project with existing RIFT identity and metered credits.
**Architecture:** Extend the already approved desktop native design to a standalone entrypoint. Python standard-library launcher owns a nonce-scoped loopback relay to the existing native gateway and starts the complete verified signed Codex bundle with inherited TTY. No new model service or Rust engine fork changes.
**Tech Stack:** Python3, installed native Rust/Ratatui bundle, existing RIFT Responses gateway.

## Global Constraints

- User explicitly authorizes replacing the terminal `rift` entrypoint with this same engine/account behavior. Preserve previous executable and legacy state; no production publishing or commits.
- Keep the actual RIFT key in launcher memory; child gets only ephemeral route nonce. Never print credentials, forward redirects, or inherit API/provider credentials into child tools.
- Fixed saved login origin must be https://riftsys.app or loopback localhost3020/3022. Gateway authenticates account/credit eligibility; no OpenAI login or provider fallback.
- Full bundle includes rift, code-mode host, models.json, LICENSE, NOTICE, provenance. Validate checksums before installing; staging failure leaves old entrypoint working. Version/help can work offline.
- Native terminal state is separate from desktop and legacy state, scoped to authenticated owner. Preserve cwd and CLI arguments; defaults on-request/read-only. CLI has native resume semantics.
- Relay accepts only bounded POST /responses with current nonce, fixed upstream endpoint, bounded concurrency/timeouts, no retry. Close relay on child exit/signals; no public listening interface.

## Task1: Launcher and installer

Files: packages/desktop/scripts/native-cli.py, install-native-cli.py, test_native_cli.py.
Interfaces: installed private directory contains launcher and full bundle, ~/.local/bin/rift invokes launcher. CLI reads ~/.config/rift/console.json; GET /api/console/native/config, POST /api/console/native/responses.

- [x] Add failing tests for credential isolation/nonce authorization/route and body bounds, account/model mapping, subprocess cwd/args, installer verification failure and prior entrypoint preservation.
- [x] Implement minimal launcher/relay and atomic installer; use existing native_codex.rs mapping as source of truth for upstream catalog metadata. Keep service errors explicit and secret-free.
- [x] Run unittest suite until green and focused independent review. Do not invoke live account or install from worker.

## Task2: Local installation and acceptance

- [x] Root installs from /Applications/RIFT UI Preview.app/Contents/Resources/native-codex with backup, verifies `command -v rift`, version and help.
- [x] Root runs bounded paid live `rift exec` in temporary fixture (read-only marker), authenticating existing RIFT account and gateway. Verify no separate login and correct model route.
- [x] Root opens real TTY with `rift`, checks native TUI appearance and graceful exit; record exact limits/backup/commands in report.
