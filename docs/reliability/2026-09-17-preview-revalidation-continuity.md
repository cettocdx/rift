# Preserve an open preview during transient revalidation failures

## Defect and fix

`useBuildPreviewHealth` replaced a previously verified running preview with
`transient` when a later read-only health check failed or timed out. The panel
then removed the iframe, discarding the embedded app's unsaved interaction
state. An explicit health retry also changed the identity key and removed it.

The hook now separates preview identity (chat + saved URL) from the attempt
counter. A transient check failure retains a verified browser only for that
same identity and exposes `revalidationFailed`. The panel displays a compact
notice and a read-only retry. It does not claim that the preview is currently
verified running while that notice is shown.

Initial unverified previews still wait for verification. A different chat or
URL clears prior verification. Authoritative stopped/paused/stale/access-denied
responses remove the previous frame. Explicit Reload still reloads it. No
workspace creation, command restart, or model call is added.

## Evidence

- Three new regressions failed before the change (network failure, HTTP 503,
  and check timeout); all passed after the change.
- 21 focused health/dialog tests passed, including identity fencing, paused
  environment resume, denial of access, and late responses.
- The existing 54 mobile-tool browser tests passed before this change.
- Six new browser checks passed after the change: Chromium and WebKit at
  360, 390, and 430 CSS pixels. These load an actual iframe, change its button
  state, simulate a retained pane becoming inactive/active, make the health
  endpoint return 503, retry successfully, and verify one iframe document
  request and preserved button state. A following 403 removes the iframe.
- TypeScript, scoped ESLint, and diff whitespace checks passed.
- The WebKit 390px screenshot was visually inspected: notice, retry, preview
  controls and interactive content fit within the viewport.

The browser service and active-prop transition are controlled fixtures. These
checks do not simulate iOS process suspension, prove physical-device keyboard
behavior, or establish that every remote preview stays alive.

Logs:

- `/tmp/rift-preview-revalidation-red.log`
- `/tmp/rift-preview-revalidation-regression.log`
- `/tmp/rift-preview-revalidation-browser.log`
- `/tmp/rift-preview-revalidation-types.log`
- `/tmp/rift-mobile-tool-audit.log`

Screenshot:
`e2e/mobile-fixture/results/mobile-tools/mobile-tools.fixture.ts-tr-c8c00-nd-retry-does-not-reload-it-webkit-390/preview-retained-on-network-failure.png`

Release build status and delivery must be checked independently; a passing
fixture is not proof that the public domain or desktop bundle uses this code.

## Local delivery

Production build completed successfully in
`.next-ui-release-1789614519881-23456b3c`. The isolated server is listening at
`http://localhost:3072`; the signed-in Brevier conversation loaded there and
the in-app browser tab was marked as the deliverable. This does not update the
public domain, the existing main worker, or the installed desktop bundle.
Build log: `/tmp/rift-preview-revalidation-ui-build.log`.
