# Mobile web: Safari layout and workspace retention

## Reproduced causes

- iOS Safari can shrink both `innerHeight` and `visualViewport.height` when its keyboard opens, while the layout viewport remains taller. The old observer compared only the two visual heights and released the fixed chat shell. Real simulator measurements: visual height 377, layout shell height 714, scroll/offset 337, shell y=-337, scale=1. This was page displacement, not pinch zoom.
- The document contained both Next's generated viewport and a manual viewport declaration. The root now exports one Next `Viewport` configuration.
- Mobile inputs without a `type` attribute, plus URL/telephone inputs, missed the existing 16px coarse-pointer floor. Fine-pointer user font preferences remain respected.
- The offscreen skip-to-content link cast a visible shadow onto the light header. Its shadow now appears only on keyboard focus.
- Mobile New chat had a fixed blue fill. It now follows foreground/background theme tokens; the browser theme-color follows the resolved theme.
- Mobile computer/preview dialogs could exceed the phone width. The full-width dialog and fixed header layout are covered by real component fixtures.
- Terminal readiness failure could kill an existing sandbox, then pass null into an environment-specific sandbox setter. The result could be both lost workspace data and an execution-environment mismatch. Reconnection also recreated workspaces after connection errors or image-version changes.
- A persisted desktop connection row was accepted as proof that a Mac was online. Browser actions could wait for an unavailable desktop relay.
- Client preview selection accepted a URL without the successful tool evidence required by the server. Both now share the same evidence selector.

## Changes and boundaries

The viewport observer uses the larger of document clientHeight and innerHeight as the layout baseline, and visualViewport measurements for visible height and offset. It preserves native pinch zoom. In the same Safari keyboard test, shell y is now 0 and shell height 377; Activity remains reachable and the draft survives opening/closing the panel.

Readiness failure returns a retryable `not_started` result against the same workspace. Reconnection no longer deletes or silently replaces an existing workspace after an error or version change. Reconnected workspaces receive the same two-hour keepalive as new workspaces. This prevents the identified destructive recovery; it does not resurrect an already deleted workspace or guarantee uninterrupted service from a provider.

Desktop relay checks owner-scoped connection presence before publishing an action. Tool guidance distinguishes a connected Mac browser action from cloud website research/testing. Permissions and execution-target boundaries remain enforced.

## Verification evidence

- Real iOS 26.5 Safari software keyboard, on isolated simulator RIFT Acceptance 0917: the original Activity visibility assertion failed before the fix and passed after it. `/tmp/rift-mobile-safari-fixed-ready.xcresult` and its log retain screenshots and measurements.
- Viewport observer regression suite: 17 passed, including the exact 377/714/337 geometry. The new regression failed before the change.
- Mobile panel suite after the final Safari geometry change: 54 passed across Chromium/WebKit at 360, 390 and 430 pixels (`/tmp/rift-mobile-tools-viewport-final.log`).
- Extended real Safari keyboard → Activity → preview → chat regression also passed (`/tmp/rift-mobile-safari-preview-final.xcresult`). Draft content survived both panels.
- Font matrix: 34 passed, 8 intentional skips for inapplicable pointer cases. Both enlarged preferences and narrow fine-pointer sizing are covered.
- Terminal/sandbox/local-relay suites: 82 passed. Desktop workspace tools: 19 passed.
- Preview/status/resume/theme suites: 61 passed. Chat shell mobile suite: 19 passed.
- Isolated live E2B canary: reconnected to the same sandbox, retained a marker file, reported 7,199 seconds remaining, and confirmed cleanup of only the owned canary. `/tmp/rift-mobile-review-0917/workspace-canary.json`.

The real Safari fixture uses production React components with mock backend responses. It does not sign in, launch a real Build/Hack job, or prove production end-to-end reliability.

## Still open

The video task's saved preview points to a sandbox that is already missing. Both local and public status endpoints reported that state. A successful panel test does not mean this historical preview has recovered.

The recorded failed subagent has insufficient persisted failure metadata to prove its underlying cause. Generated application build errors, provider failures, and sandbox loss must not be collapsed into one presumed network cause.

Main web 3020 and the Trigger worker have not been restarted or upgraded during this work. Their maintenance inventory contains unresolved active execution claims. Public `riftsys.app` and existing worker tasks therefore must not be described as running these fixes. The release is built and reviewed separately; production rollout and real long-task/mobile acceptance remain outstanding.

Final production build including TypeScript passed: `.next-ui-release-1789605270294-9b68e879`, log `/tmp/rift-mobile-release-safari-final.log`. It is served separately at `http://localhost:3060`. The root responds HTTP 200 with exactly one viewport meta declaration. Ports 3020, 3057, 3058 and existing user tasks were not stopped for this release.
