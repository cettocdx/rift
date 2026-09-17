# Worker database scope and mobile shell follow-up

## Worker correctness before reuse

The prior process-global `setConvexUrl` was safe only under isolated worker processes. An offline regression reproduced A-preview followed by an omitted override retaining A instead of the default deployment. This is evidence of an unsafe reuse assumption, not an observed production cross-deployment incident. Process reuse remains disabled.

The worker now captures its deployment at entry and lazily owns its own Convex client through a Node-only AsyncLocalStorage adapter. The shared Convex-facing accessor has no Node dependency and still initializes lazily outside worker contexts. An omitted URL is explicitly captured from the default; missing configuration never falls back to a later environment value or another run.

The full agent body, including catch/finally, executes in scope. The out-of-band cancellation cleanup is explicitly bound to the originating scope; its refund and PTY cleanup retain that run's identity. Scheduled workers and dispatchers have separate scopes, including failure settlement; child tasks receive the captured resolved URL rather than reading a changed environment later.

This follows Node's [asynchronous context API](https://nodejs.org/api/async_context.html): asynchronous work inherits the run context, while externally invoked callbacks need explicit binding. No `disable()` call clears pending work at run completion. The [Convex HTTP client](https://docs.convex.dev/api/classes/browser.ConvexHttpClient) can carry mutable authentication, so separate task clients are also necessary when URLs match.

Verification at implementation checkpoint:

- Original regression failed with expected default URL / received preceding preview URL.
- 43 focused tests passed across five suites: concurrent and sequential A/B/default, nested failure, changing/missing defaults, independent clients, late completion after cancellation, externally invoked cleanup, actual scheduled entrypoints and child forwarding/settlement.
- A separate offline Node test bundles the actual production scope implementation and actual Convex HTTP client against two loopback HTTP servers. Five requests verify endpoint routing and no user-A auth header in B or a fresh same-deployment run, including cancellation cleanup invoked from another scope. No remote service or real token is used.
- TypeScript and targeted ESLint passed. Browser-platform bundling of the shared accessor succeeded without Node builtins. This is compatibility evidence, not a Convex production deployment.
- One persisted live explanation task completed on development worker `20260911.61`: run `run_06g92r28up4nj95c867nf07h01`, chat `0664f8ea-ebf3-4c50-81d7-9c11864862ea`; expected final sentinel, zero observed duplicates/tools. First text 10,661ms, total 15,216ms. This verifies the current worker path; it is not a latency improvement or a live multi-tenant isolation test.

Remaining reuse blockers: some backend helpers capture service credentials at module import while others read them later, and other cached clients retain environment configuration. URL isolation alone is insufficient to enable reuse safely. Credential binding, other cached-client lifecycle handling and production environment validation remain separate work.

The next audit targets are the imported service keys in `lib/db/actions.ts`, `lib/tasks/scheduled-task-backend.ts`, `lib/suspensions.ts` and `lib/ai/runs/run-recorder.ts`; moderation/Redis clients; OpenRouter request-time credential lookup; global PostHog queues/destinations; and media/local-runner environment lookups. Replacing imported constants with fresh global environment reads would still leave late callbacks unsafe. These settings need explicit run ownership or a documented immutable process configuration boundary before changing worker lifecycle policy.

## Deferred MCP callbacks

MCP loading now captures its database client and service key together. Lazy discovery, OAuth token persistence, credential rotation and health updates use that captured origin even if the SDK invokes a callback from another asynchronous context. Discovery still re-queries server ownership on the originating database; capturing an origin does not bypass revocation or configuration-revision checks.

All four new origin regressions failed against the preceding source version, including an actual OAuth provider `saveTokens` callback invoked after switching to a different scope. The revised loader passed 22 tests across four suites. These are controlled tests with mocked remote storage/transport, not live OAuth-provider or multi-tenant production certification. The exported loader API and deferred transport imports are unchanged.

A follow-up found that the vault's default environment lookup could still encrypt A's credentials using B's later keyring. The private origin now also captures a frozen, four-field vault configuration (active version, keyring, captured service credential and environment mode). Every decrypt/encrypt/rotation operation receives this configuration explicitly. Four additional regressions failed before this fix; the combined MCP verification passed 33 tests across five suites. OAuth refresh, lazy OAuth rotation, encrypted headers and legacy-header migration remain readable with A's keys and fail with B's keys, while writes stay on A. No environment values or real credentials are included in the evidence logs.

## Mobile shell

The structural chat fixture reproduced a 390×400 layout with a 12-line draft whose Send control extended to 632px. A second regression kept the layout viewport at 844px while shrinking only the reported visual viewport to 400px; the Send control remained at approximately 823px. The earlier composer-height cap also allowed its editable wrapper to collapse to zero height under fixed goal/toolbar controls at 320px and 240px.

The route now follows valid mobile visual-viewport measurements through a small DOM observer with frame-coalesced writes. It restores original geometry on desktop, pinch zoom, invalid measurements and cleanup. It does not rerender the transcript or estimate keyboard height. The mobile composer caps only its editable area, preserving goal and toolbar height. Pending questions share the remaining space and, when necessary, offer bounded scrolling to reach both question and draft actions. Expanded and collapsed questions, including multi-select questions, retain reachable controls. Additional outer scrolling is limited to mobile question layouts; desktop keeps its existing transcript scroll owner.

Source review rejected an intermediate grid approach and a global outer-scroll change. A later interaction test found a disappearing collapsed question header at 240px; the final correction preserves its intrinsic height. Evidence retains these failures rather than presenting only the successful cases.

The browser matrix imports the real route viewport, Pro header, question card, composer, goal bar and toolbar, with copied conversation wrappers and stubbed service/transcript boundaries. It checks short layouts, selection/custom responses/submission, preserved drafts, collapse/reopen, landscape changes, visible-viewport-only resizing, offsets, zoom restoration, hit geometry and normal-height inner scrolling. Mobile WebKit's overflow scrolling is explicitly simulated with `scrollBy` before coordinate input because Playwright does not support wheel input for mobile WebKit; this is not an OS swipe test. Full authenticated transcript restoration through `useMessageScroll`, physical-device software keyboard timing and native Safari behavior remain unverified by this fixture.

Final browser run: **44 passed, 4 explicitly skipped desktop-only inapplicable mobile edge cases, 0 failed, 0 flaky**, 65.3 seconds. Chromium and WebKit ran at 360/390/430px mobile widths and a 1200px desktop width. All 23 viewport/route-landmark tests also passed (16 observer cases and seven landmark cases), and scoped ESLint was clean. The final helper waits for the reported viewport layout before attempting bounded scrolling and checks the full control rectangle, not just its center point.

## Cursor Agents reference

The native Cursor Agents window was opened again for direct interaction with its composer and context/tools menu, without switching to IDE. The observed menu combines searchable skills, files, model selection and MCP; model and effort are summarized in one composer control. Escape returns to the draft. Native screenshots are retained with the external evidence bundle. These observations support the existing RIFT parameter consolidation and future context-menu refinement; they do not reveal Cursor's private harness implementation or establish equal performance. No comparative task was submitted during this inspection.
