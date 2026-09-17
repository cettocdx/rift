# RIFT source handoff — 2026-09-11

This release-candidate branch captures the current web app, desktop shell, terminal
console and Local runner together. It is a source baseline, not a production
approval or a claim that the remaining reliability/performance gates are complete.

## Source locations

- Release branch: `codex/release-candidate-2026-09-11`.
- Visible, independent checkout for handoff: `/Users/cetto/RIFT-Release`.
- UI Preview web service source: `/Users/cetto/RIFT-Release`, verified from the
  `app.riftsys.ui-preview-web` LaunchAgent working directory. It serves the
  successful release build on port 3020; editing source does not hot-reload that
  build. Build successfully, then restart the web service to apply changes.
- Preview worker and managed Local runner also launch from `/Users/cetto/RIFT-Release`,
  supervised by `app.riftsys.ui-preview-worker` and `app.riftsys.local-runner`.
  Their earlier `reference-ui` paths were migrated after idle checks. The worker
  still uses Trigger **development** mode; this is not a production promotion.
- Installed Preview shell: `/Applications/RIFT UI Preview.app`. Launch this full
  path; older bundles can share its bundle identifier. Native changes require a
  new desktop build and installation. The Trigger development worker has not
  been promoted to production as part of this source handoff.
- Web and harness: `app/`, `lib/`, `convex/`, `trigger/`.
- Canonical desktop: `packages/desktop/`, including `src-tauri/tauri.conf.json`.
- Interactive `rift` console: `packages/console/`.
- App-to-machine Local runner: `packages/local/` (`rift-cli`).
- Root `src-tauri/` is legacy compatibility code, not the production package target.

Confirm the exact snapshot with `git rev-parse HEAD` and `git status --porcelain`.
The latter must have no output. No remote push or production promotion is part of
this handoff. Git history has not been rewritten or audited for historical secrets.

## Clean installation and checks

Use Node 22, pnpm 10.33.2 and Bun >=1.3 for the OpenTUI console. Desktop packaging
also requires Rust and the platform's native development tools (Xcode on macOS).

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec jest --runInBand
node --test scripts/__tests__/release-source-config.test.cjs packages/desktop/scripts/*.test.cjs
pnpm --dir packages/console test
pnpm --dir packages/console test:tui
pnpm --dir packages/local build
pnpm --dir packages/desktop exec tauri build --bundles app
```

The preview build uses a fresh output directory and only publishes its pointer
after success. It must not change tracked source or TypeScript configuration.
Next route types, the desktop launch HTML and Tauri schemas are generated from
source rather than committed. `pnpm typecheck` generates route types first.

For an offline source-compilation check without account credentials:

```sh
NEXT_PUBLIC_CONVEX_URL=https://build-only.convex.cloud STRIPE_SECRET_KEY=sk_test_build_only_not_a_real_key pnpm build:ui-release-preview
```

These are deliberately nonfunctional fixture values. Do not run or deploy that web
output as a working product. The current web routes initialize Convex and legacy
Stripe clients during page-data collection, so a completely empty environment fails
the build. A real web release needs the intended public Convex URL at build time
and the configured runtime integration credentials; use `pnpm build:ui-release-preview`
with that environment. The source-compilation check validates source and packaging,
not live integrations.
For connected development, copy `.env.example` to `.env.local`, fill credentials
through a private channel, and run `pnpm doctor`. Never commit or share `.env.local`,
runner tokens or login data. Other accounts must authenticate separately.

`pnpm dev:ui-preview` starts a web server and Trigger development worker on port 3020. Do not run it alongside the existing Preview web/worker services. An isolated
web-only development server can instead use `pnpm dev:next` (port 3010); it does not
start a worker or configure backend credentials automatically.

## What stays outside the source baseline

Dependencies, builds, caches, coverage, temporary exports and raw JSON/log QA
captures stay on the original machine and are ignored by Git. Markdown QA summaries
are retained; links to ignored raw evidence are available in the original worktree,
not in a fresh clone. Existing referenced product media and the Local runner download
are retained because the app uses them.

The candidate was checked for common credential patterns and exact matches to local
configured secrets without printing their values. This check is not a full security
audit. An environment-matching value in a setup guide was replaced with a placeholder;
existing infrastructure credentials were not rotated during source cleanup.

## Remaining release gates

Apple distribution signing/notarization and clean-Mac validation; production worker
promotion; complete multi-user isolation and billing recovery tests; backup restore;
long-session UI acceptance and startup latency below the agreed 4-second target.
See the dated reports under `docs/qa/` for their actual measurements and limitations.

## Native terminal and mobile acceptance follow-up

The installed UI Preview includes native terminal retention across renderer reload.
See [durable native terminal evidence](2026-09-11-durable-native-terminals.md) for
actual process preservation, completed-session replay and burst-output observations.
The subsequent [bounded terminal follow-up](2026-09-11-bounded-terminal-mobile-composer.md)
and [readiness follow-up](2026-09-11-terminal-readiness-mobile-switch.md) cover
active-output transport and readiness changes. The latest [runtime report](2026-09-11-runtime-continuity-and-latency.md)
records real Local fault injection, Settings layout restoration and the current
20-sample startup result; it does not claim production-wide reliability.

Public mobile auth-screen checks now have a maintained Chromium/WebKit suite:
`pnpm exec playwright test --config e2e/mobile-public/playwright.config.ts`.
[Authenticated mobile acceptance](2026-09-11-authenticated-mobile-gate.md) remains
open until real externally supplied sessions exercise the route suite. Physical
keyboard/safe-area behavior and account recovery also need acceptance; there is
currently no exposed forgot/reset-password flow in the public auth surface.
