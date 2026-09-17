# RIFT release audit - 2026-07-21

This is the release gate for the user's accumulated product directives. A box
is checked only after the current working tree is verified with a deterministic
test, browser evidence, native build evidence, or a live service probe. Prior
reports are context, not proof for this release.

## Release rules

- [x] Full Jest suite passes on the final tree.
- [ ] TypeScript, ESLint, formatting/whitespace and Next.js production build pass.
- [x] Public and authenticated browser routes have no framework overlay, console
      error, failed critical resource, horizontal overflow or obvious layout jump.
- [x] Dark and light themes are inspected at desktop and mobile widths.
- [x] Desktop release contract, native tests, DMG build, signature assessment and
      login handoff are verified.
- [x] Production deployment is immutable, `READY`, HTTP 200 and has a clean
      post-deploy error scan.

## Brand and shared product shell

- [ ] Canonical transparent RIFT-X-PROFILE mark is used across web, desktop,
      favicon and downloadable assets; Orbit and the old blue app icon are absent.
- [ ] The mark is visually larger without a boxed background.
- [x] Cursor-class surface tokens are consistent: application canvas near
      `rgb(20 20 20)`, sidebar near `rgb(24 24 24)`, restrained one-pixel borders,
      native UI typography and readable Cursor/Codex-like white hierarchy.
- [ ] Light mode has equivalent hierarchy, visible controls and WCAG AA text/form
      contrast.
- [x] The app is not needlessly cut by a top strip on web or desktop.
- [x] Desktop sidebar is translucent where native composition allows it, can be
      resized, fully collapses without leaving an icon rail and restores from a
      control beside the macOS traffic lights.
- [x] Native titlebar drag regions allow moving the window without stealing
      interactive controls.
- [x] Lower-left account area shows the real user name, usage and Free/Pro/Max
      plan without a generic `User` label or bottom-edge collision.
- [ ] Browser favicon is an unboxed, legible RIFT mark at favicon scale.

## Login and account creation

- [x] Login and signup use the same intentional 50/50 desktop composition.
- [x] The supplied login visual is edge-to-edge on its half, adapted without its
      embedded lower logo, with correct cropping and high-resolution output.
- [x] `Product Film` and `RIFT Workspace` copy is absent from authentication UI.
- [x] Desktop launches directly into login/product auth, never the marketing
      landing page.
- [x] One-time desktop sign-in creation, callback and return flow work without
      `Desktop sign-in is unavailable`.
- [x] Authentication surfaces collapse cleanly on mobile and retain labels,
      focus treatment, errors and usable tap targets.

## Landing, download, pricing and legal

- [x] Landing hero uses a real or generated high-quality product visual and does
      not say `Match Cursor` or imply that RIFT is a Cursor clone.
- [x] Build imagery contains RIFT-specific application content and no Cursor
      wording.
- [x] Landing clearly explains Build, supported LLM access, Studio and the real
      product workflow without fabricated working UI.
- [x] HackWorkbench receives a prominent, accurate section describing its
      authorized pentest workflow, RIFT security model and tool capacity without
      irresponsible claims of unrestricted intrusion.
- [x] Model-control cards use correct provider/model marks and intentional native
      brand colors with adequate resolution.
- [x] Landing motion communicates state/story, respects reduced motion and does
      not jitter the page header while scrolling.
- [x] Landing is visually balanced rather than uniformly dark and uses the RIFT
      brand palette consistently.
- [x] Download page presents the download action first and a distinct professional
      space/world visual below it; it does not reuse the landing hero verbatim.
- [x] Settings Pricing, `/pricing` and `/upgrade` share the current product UI and
      do not route to an obsolete surface.
- [x] Terms, privacy and refund pages use the current design system and current
      product/billing language.
- [x] Public pages are responsive at 375, 768, 1024 and 1440 pixels with no
      horizontal overflow.

## Composer, models and commands

- [ ] Composer width/height supports normal sentences without premature wrapping
      and matches the dense Cursor-class shell.
- [x] Redundant visible Local/Cloud chooser is removed from the normal composer
      while execution capability remains policy-controlled.
- [x] GPT-5.3 is absent from every selectable model catalog and alias.
- [x] Kimi and Qwen labels/IDs match models actually supported by configured
      providers; unsupported marketing-only model names are not invented.
- [x] Every selectable LLM exposes only its supported Low/High/Extra High/Max
      reasoning strengths and sends the chosen value to the server.
- [x] Model and reasoning menus scroll within the viewport instead of clipping.
- [x] `/model` opens/selects a model and every advertised slash command performs
      its declared action with usable feedback.
- [x] Pentest slash commands are absent from normal Build and available only in
      HackWorkbench.
- [x] `Plan new idea` is absent.

## Build agents and long-running execution

- [x] Starting Build automatically exposes the agent activity panel and lets the
      user open/close it later.
- [x] Agent panel shows meaningful task/agent/step state without decorative
      `Live` text or dot.
- [ ] Agent panel typography matches the product shell.
- [x] Horizontal panel resizing is easy, smooth, keyboard accessible, clamped and
      persisted.
- [x] Build reasoning is active and professional without revealing private
      chain-of-thought; the thinking indicator moves while work is active.
- [x] Image/video generation uses equally polished progress presentation and
      clear tool-stage feedback.
- [x] User-visible `Reached the time limit for this turn` does not interrupt an
      otherwise recoverable Build; continuation is automatic and bounded against
      loops.
- [x] Long-running Claude/Codex-like work survives transport reconnects and
      persists progress instead of requiring repeated `continue` prompts.
- [x] Build can read explicitly provided HTTP/HTTPS and localhost URLs through
      policy-checked browser tools.
- [x] Desktop Build can access only user-granted local folders/computer resources,
      with explicit revocation and no unrestricted silent machine access.

## CLI Workspace

- [x] Command-J opens Workspace with the real terminal focused.
- [x] Shell, Claude Code, Codex and Grok launchers report availability from actual
      host detection and start/focus a working PTY when installed.
- [x] The terminal column omits decorative dots and the phrases `Terminal 1 shell`,
      `Sandbox shell only` and dot-prefixed `Connected`.
- [x] Terminal status typography and spacing match the rest of RIFT.
- [x] Terminal sessions, scrollback, reconnect, resize and workspace-root security
      are covered by tests.

## Plugins and MCP

- [x] Every advertised integration renders its official logo from a maintained
      local asset and never a guessed glyph.
- [x] Connect, OAuth/token configuration, probe-before-save, recheck, disconnect,
      capability discovery and error states are real and easy to understand.
- [x] All owned MCP tools become available to the runtime only after successful
      validation; read-only and plan policies fail closed.
- [x] Provider credentials stay server-side, encrypted/redacted and never enter
      the client bundle or logs.
- [x] Plugins route has complete loading, empty and error states.

## Billing, plans and credits

- [x] Monthly Usage always shows the signed-in user's included-credit allowance,
      used amount, remaining amount and reset date.
- [x] Max allowance uses the intended 1.8M-credit ledger representation without
      destructive or repeated legacy migration.
- [x] The removed `extraUsage:migrateLegacyIncludedUsage` public-function error
      cannot recur.
- [x] Eligible users can buy Lemon Squeezy add-on credits; success, webhook,
      idempotency, refund and visible balance behavior are covered.
- [x] HackWorkbench is server-enforced for the $129 Max plan, not merely hidden in
      the client.

## Studio and Artifacts

- [x] Each Studio tool/model uses distinct, stable, professional preview media;
      videos do not flicker or restart during normal React updates.
- [x] Generated images and videos persist after completion and navigation, appear
      in Studio/Artifacts and can be downloaded.
- [ ] Generation placeholder/reasoning boxes are visually coherent, agentic and
      accessible in both themes.
- [x] `/artifacts` resolves without 404 for anonymous/authenticated route handling
      and renders loading, empty, error and populated states.
- [x] Media URLs and storage records are durable and do not depend on expiring
      provider-only links.

## HackWorkbench

- [x] Max-plan gate is enforced on page, API and session paths.
- [x] Security tools and reports operate only on authorized targets with the
      existing scope/consent safeguards.
- [ ] Mascot has comfortable viewport clearance on desktop and mobile.
- [ ] Protected HackWorkbench behavior has no regression in chat, file, evidence,
      finding, report, export, keyboard and responsive flows.

## Performance, mobile and final evidence

- [ ] Warm route transitions meet the 500 ms target in a production profile.
- [ ] Desktop Build-to-Studio navigation stays inside the SPA, avoids eager heavy
      media work and meets the warm route budget without visible frame stalls.
- [x] Composer typing, panel resize, terminal echo, transcript append and editor
      switching retain their documented deterministic performance invariants.
- [ ] Studio videos, landing media and logo assets reserve space and avoid CLS.
- [x] Authenticated product surfaces provide mobile-specific navigation and tools,
      not just a compressed desktop layout.
- [x] No critical route has an uncaught runtime error, stale error overlay or
      broken internal navigation.
- [x] Final desktop DMG uses the canonical icon, opens under Gatekeeper policy or
      has an explicitly documented signing/notarization blocker.
- [x] X profile logo and banner deliverables exist on the Desktop in the requested
      export formats.

## External-service gates

These items require real accounts or credentials. They are not marked complete
from mocks alone.

- [ ] Paid text, image and video provider calls succeed with production keys.
- [ ] Real GitHub and third-party MCP OAuth callbacks succeed against production
      callback URLs.
- [ ] Lemon Squeezy production checkout and webhook delivery succeed.
- [ ] Apple Developer ID signing and notarization succeed for the DMG.
- [ ] Full authenticated Playwright matrix has isolated test users and `.env.e2e`.

## Verified evidence recorded for this tree

- Final-tree whole-repository Jest completed with 355 suites and 2,894 tests
  passing. The Artifacts video query and UI are also isolated by 2 focused suites
  and 6 passing tests.
- Plugin, MCP, billing, credit, model and slash-command regression: 41 suites,
  329 tests passing.
- Studio/Build transition regression: 4 suites, 53 tests passing. This verifies
  route ownership and deferred heavy-media loading, but is not a real-browser
  measurement of the 500 ms target.
- Settings Pricing regression: 2 suites, 15 tests passing. Local Chrome loaded
  `/pricing` with HTTP 200 and no Next.js overlay, console error or page error.
- Native CLI evidence: Rust 10/10; desktop/auth/terminal Jest 100/100;
  titlebar/release contract 11/11. The rebuilt DMG passed `hdiutil verify` with
  SHA-256 `637e6d1955f73890db12fc6ba8ba71e50e3bd86c4efd099dc0c95c7e567299a6`.
- Final-tree ESLint and the Next.js production build passed; the build completed
  TypeScript and emitted 63 static pages. The audit document passes Prettier and
  `git diff --check`, but the repository-wide `pnpm format:check` currently fails
  on 1,367 paths, including generated desktop build output and source files. The
  combined formatting/build release checkbox therefore remains open.
- Desktop deliverables found: `RIFT-X-Profile-2048.svg`,
  `RIFT-X-Profile-2048.png` and `RIFT-X-Banner-Higgsfield-1500x500.png`.
- Convex production `content-robin-881` deployed the current schema and functions;
  its live function spec contains `extraUsage.js:migrateLegacyIncludedUsage`,
  `artifacts.js:listForUser` and the current entitlement/skill functions. The
  signed-in production Monthly Usage UI shows the 1.8M Max ledger and add-on
  balance without the former missing-function error.
- Vercel production deployment `dpl_GwTcAipAmSzbPAXarAr2RiSKqBCn` is immutable,
  `READY` and aliased to `https://riftsys.app`. Landing, download, pricing, login
  and signup returned HTTP 200 without console errors or horizontal overflow;
  authenticated Build, Artifacts, Plugins, Workspace, Studio, Hack Workbench,
  Pricing and Download resolved on their intended routes. The post-deploy Vercel
  error scan returned no errors.
- The live `/model` command opens the real selector. Its menu is scrollable
  (`343px` viewport over `439px` content), contains the current configured model
  families and does not contain GPT-5.3.

## Open release blockers

- The DMG is ad-hoc signed, has no TeamIdentifier, is rejected by `spctl` and has
  no stapled notarization ticket. Developer ID signing, notarization and stapling
  remain mandatory before promotion.
- Paid image/video generation has only deterministic persistence and rendering
  coverage; no real paid provider call was made for this audit.
- Third-party OAuth and MCP flows have deterministic contract tests, but no real
  production GitHub/provider callback was completed.
- Lemon Squeezy behavior is covered by tests, but production checkout and webhook
  delivery were not live-probed.
- No authenticated production-profile browser timing run proves the 500 ms warm
  route target, and the complete authenticated Playwright matrix is not present.
- Repository-wide formatting is not clean: `pnpm format:check` reports 1,367
  paths. Generated desktop output should be excluded and remaining source files
  formatted in a separately reviewed change before release.
