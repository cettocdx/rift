# RIFT OpenCode Fork Implementation Plan

> **For agentic workers:** Use executing-plans to implement these tasks in this session.

**Goal:** Install a source-built, RIFT-branded OpenCode CLI launched with `rift`, with all supported account models in one menu.

**Architecture:** Pin OpenCode v1.18.31 in `/Users/cetto/RIFT-CLI`; maintain small source changes for branding, isolated paths, account launch, and distribution. Reuse the tested RIFT account relay and server billing gate, extend its model catalog, and install a versioned local binary atomically.

**Tech Stack:** Bun, TypeScript, Solid/OpenTUI, Python launcher, Next.js RIFT gateway.

## Global Constraints

- Preserve upstream LICENSE and copyright notices.
- Retain the existing RIFT account and credit ledger. Do not expose provider keys.
- One CLI engine and one model menu for GPT and non-GPT models.
- Preserve existing installation and session data for rollback.
- Standalone CLI scope; desktop embedded console is a separate follow-up.
- No public deployment or publication without the corresponding user instruction.

### Task 1: Source-built RIFT CLI

**Files:** `/Users/cetto/RIFT-CLI/packages/opencode/src/index.ts`, `src/cli/ui.ts`, terminal logo and global path modules, `script/build.ts`, `test/rift/branding.test.ts`, root `RIFT.md` and provenance.
**Consumes:** Official v1.18.31 source and license.
**Produces:** A local arm64 binary with RIFT help, logo, version, storage, and product links.

- [x] Clone pinned tag, read AGENTS and nested guidance, create `rift-cli` branch; record `git rev-parse HEAD`.
- [x] Install pinned dependencies with `bun install --frozen-lockfile`; run relevant existing baseline tests from the package directory.
- [x] Add an executable smoke test that expects `--help` to identify `rift` and checks isolated storage; run against upstream and observe failure.
- [x] Change user-visible CLI branding and product paths in source, preserve compatible internal protocol names, disable upstream installer/update actions.
- [x] Build with the upstream single-target build script; run branding smoke test and scoped upstream tests.

### Task 2: Unified RIFT account and models

**Files:** RIFT-Release `app/api/console/opencode/config/route.ts`, its `__tests__/route.test.ts`; new `packages/desktop/scripts/rift-cli.py`, `test_rift_cli.py`; fork launcher assets under `rift/`.
**Consumes:** Existing native account authorization, Responses relay, model catalog, saved personal login.
**Produces:** A default OpenCode-based launcher with GPT and non-GPT catalog, same owner-isolated sessions, account errors, and permissions.

- [x] Change the route test to require both GPT IDs alongside non-GPT models and no provider secrets; run `pnpm exec jest --runInBand app/api/console/opencode/config/__tests__/route.test.ts` and observe failure.
- [x] Return the existing accepted Responses model catalog from OpenCode config; retain identity, suspension, billing and no-store checks.
- [x] Test launcher default engine, explicit models, compatibility alias, offline help, pre-auth argument rejection, saved login migration and failure exits.
- [x] Implement the launcher using the proven relay and argument validation, with no model-based engine branching and no upstream account dependency.
- [x] Keep model selection persistent by allowing the TUI saved model to take precedence over a fallback default when no explicit selection is supplied.
- [x] Run scoped gateway and launcher tests plus the existing relay failure suite.

### Task 3: Installation and acceptance

**Files:** Fork `rift/install.py`, `rift/test_install.py`, `rift/README.md`; RIFT-Release `docs/superpowers/reports/2026-09-16-rift-opencode-fork-acceptance.md`.
**Consumes:** Tested source-built binary, pinned upstream SHA, launcher modules and LICENSE.
**Produces:** Atomic `~/.local/bin/rift` install and documented rollback.

- [x] Write an installer test for checksums, existing entrypoint preservation and failed install leaving the prior target unchanged; observe failure.
- [x] Implement immutable bundles with executable provenance and atomic wrapper replacement. Bundle required launcher files; never change global OpenCode.
- [x] Verify `rift --help`, `rift --version`, TTY startup, unified `/models`, selection, restart persistence and session history.
- [x] Run real RIFT-account GPT and non-GPT tool/continuation checks in a disposable workspace; verify permissions, cancellation, rejection and credit/usage evidence without exposing credentials.
- [x] Record passed tests, actual model coverage, remaining constraints and rollback steps. Update the local rift-console skill to match the installed architecture.
- [x] Review scoped diffs and commit only this task's files; report paths, versions and limitations.

## Execution notes

Source fork was isolated in its own repository. Concrete paths follow upstream1.18.31 package layout; launcher/account/installer code lives under the fork `rift/` directory. Verification and limitations are recorded in the acceptance report. Live credit settlement was checked through the gateway completion contract, without an independent balance audit. Toggle-style reasoning is not exposed.
