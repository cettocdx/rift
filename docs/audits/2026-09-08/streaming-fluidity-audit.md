# Streaming and interaction fluidity audit

Date: 2026-09-08. Checkout: `reference-ui`. Desktop target: **RIFT UI Preview**, `app.riftsys.ui-preview`, localhost:3020.

This extends [the earlier screen-by-screen review](./app-fluidity-review.md). The earlier short, warmed conversation sample did not establish fluidity during heavy output. This pass investigates that gap with source tracing, regression tests and a repeatable production-React component replay.

## What was actually wrong

### Completed Markdown blocks lost their render cache on every delta

`MemoizedMarkdown` created an inline link renderer inside the `Streamdown components` prop. The installed Streamdown implementation compares each renderer function when deciding whether a completed block can skip work. A new link function invalidated all those completed blocks whenever the live text changed. Existing DOM links stayed mounted, but completed content was unnecessarily recalculated.

The link renderer and the component map now have stable identities. Local file links, external links, tables, code actions and immediate streaming behavior are preserved. This is a rendering fix; it does not reduce provider inference latency.

### Moving the mouse updated the entire conversation list

`Messages` owned `hoveredMessageId`. Every enter/leave updated the parent and traversed its list, even though hover only needed to reveal the actions for one message. Actions and timestamps now use their existing named CSS group for hover and keyboard focus. Mobile and latest-response visibility rules remain intact.

The regression probe moves across 20 rows in a 200-message list. With a lightweight counting replacement for `MessageItem`, it recorded 8,000 row-function calls before and zero after. This measures parent/list fan-out, **not** 8,000 real DOM paints: production `MessageItem` also has its own memoization. Browser verification separately checks actual action opacity on hover and keyboard focus, then activates Edit with Enter.

### Unchanged conversation navigation rebuilt its observers

The outline only represents user messages, but its effect depended on a newly derived array after every assistant delta. It repeatedly detached its scroll handler, recreated its resize observer and scheduled geometry work.

The outline now memoizes against the ordered user-message identities and the scroll ref. Assistant-only updates do not rebuild subscriptions. Tests verify new user turns and immutable edits still refresh the outline. Real scroll/resize events still update the active location.

### Streaming could duplicate pending image URL requests

`useFileUrlCache` marked an image as prefetched only after its request completed. Each new message delta could therefore start another request for an image already loading. A controlled pending request plus 120 deltas produced **121 calls before, one after**.

Pending image IDs are now reserved synchronously. Each batch stores successful results and releases its pending IDs independently. Tests cover a newly arriving image while another loads, successful caching, and retry after a failed request. These are mocked request counts, not a claim that 121 network requests were observed in the user's account.

## Desktop and open-source comparison

Cursor and Claude were opened on the Mac. Their model/effort popovers were opened and dismissed without changing model settings or sending tasks. The underlying composer and task layout stayed in place. This is qualitative interaction evidence, not a comparative FPS benchmark. This pass does not claim to have instrumented Codex.

The useful source comparisons were:

- **OpenCode:** `projectV2` tracks touched messages and batches updates to their parts. It still normalizes the session collection, so this is not evidence that all processing is constant-time. The relevant principle for RIFT is preserving unaffected content instead of invalidating it on every delta. [Source](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/context/server-session.ts)
- **T3 Code:** the chat uses a virtualized timeline, explicit follow/anchor state and persistent memoized terminal surfaces. Wheel, touch and keyboard intent are treated separately when deciding whether to follow output. RIFT already has scroll-intent regression coverage; wholesale replacement of the list is not justified by the current measurements. [Source](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/ChatView.tsx)
- Open-source issue reports also describe long-history performance problems. They are useful failure scenarios, not proof those products are flawless or measurements of their current builds. [T3 report](https://github.com/pingdotgg/t3code/issues/5719), [OpenCode report](https://github.com/anomalyco/opencode/issues/17775)

## Repeatable A/B experiment

Run from the checkout:

```sh
node scripts/verify-stream-fluidity.cjs legacy mixed
node scripts/verify-stream-fluidity.cjs optimized mixed
node scripts/verify-stream-fluidity.cjs optimized mixed 2400
```

The script bundles the actual `MemoizedMarkdown`, `AssistantTranscript`, `MessageActions`, code and table components with production React. Global-state/native-file services are stubbed. The fixture uses no accounts, model calls or worker jobs and blocks outbound requests. `legacy` reinstates only the old per-delta link-function identity **inside the isolated bundle**; it does not edit application files or roll back other fixes.

Mixed scenario: 200 retained historical messages using content visibility, a live answer with 180 sections, tables and 18 code blocks, plus 60 completed tool operations and 60 reasoning entries. Historical rows remain in the scrollable document. Standard samples append 120 deltas at a requested 25 ms interval while typing a sentence, scrolling and toggling a fixture side panel six times. The fixture panel is deliberately simple; this does **not** benchmark the native Workbench browser or its IPC. Work-log disclosure is functionally checked; sustained mode also opens and closes it during streaming.

Three interleaved legacy/optimized pairs ran sequentially in headless Chromium 140.0.7339.16, viewport 1200×800. No parallel benchmark workers were used. Browser/OS scheduling and unrelated desktop activity are not controlled.

| Mixed replay metric                  | Legacy renderer | Stable renderer |
| ------------------------------------ | --------------- | --------------- |
| Frame interval p95, three runs       | 66.7–66.8 ms    | 16.8 ms         |
| Main-thread tasks longer than 50 ms  | 120 / 120 / 120 | 0 / 0 / 0       |
| Recorded interaction-event p95       | 80 ms           | 32 ms           |
| Maximum individual frame interval    | 83.4–100 ms     | 33.4–99.9 ms    |
| Input text and final output retained | All runs        | All runs        |
| Original link DOM node retained      | All runs        | All runs        |

The p95 improvement is repeatable here; isolated frame spikes were **not** eliminated. Event Timing only reports events above its 16 ms threshold, so this is not an official INP score or a complete keystroke distribution. Frame intervals are browser RAF samples, not native macOS frame measurements. Startup/initial history mounting is outside the measured interval. Raw results are in `streaming-fluidity-results.json` beside this report.

## Sustained replay

The optimized replay then continued for **86.5 seconds**, emitting **2,400 updates** at a requested 25 ms interval. Actual elapsed time is reported rather than assuming the requested timer interval was maintained. During it, the driver appended input, toggled the side panel and scrolled in **44 repeated interaction cycles**, and opened/closed the work log. The same 200 historical rows remained mounted.

- Frame interval p95: **16.8 ms**, from **4,937 samples**.
- Maximum individual frame interval: **100 ms**; isolated gaps remain.
- Tasks longer than 50 ms: **0**.
- Recorded interaction-event duration p95: **32 ms** (194 reported events).
- All typed characters and the complete final text were retained; original link identity and work-log controls passed.

This sustained run has no matched legacy-duration sample, so it is a post-fix endurance check, not another speedup ratio. Initial driver attempts exposed a macOS caret-position assumption in the test: refocused typing plus End inserted at the start instead of appending. The driver now explicitly places the caret before the requested append; the final assertions passed. Those failed driver attempts are not used as passing measurements.

## Verification

**61 tests passed across nine suites**, covering hover/list work, stable historical rows, outline navigation and edits, action visibility, completed work, transcript grouping, code actions, scroll anchoring and image-cache requests. TypeScript `tsc --noEmit` and the scoped whitespace check passed. No additional runtime dependencies were installed.

The browser replay also verifies the compiled Tailwind hover/focus rules and keyboard activation of the real message actions. It asserts complete typed input, complete final streamed content, retained link DOM identity, and opening/closing tool details. Service stubs deliberately prevent this replay from touching user data.

## Release implications and remaining validation

Follow-up: [release preview, cold-panel suspension and geometry work](./release-fluidity-followup.md) records the subsequent production frontend build, additional fixes, and remaining live frame spikes.

The currently used desktop configuration points at localhost:3020, whose UI-preview script runs `next dev --turbopack`. Development compilation/HMR and production application behavior must be measured separately. Production React in this fixture isolates the renderer defect; it does not turn the running desktop preview into a release build.

The remaining acceptance work is an equivalent release-build, native-WebView trace covering cold navigation, a sustained real agent job, images arriving mid-scroll, native browser/terminal docking and foreground/background transitions. Cursor/Claude parity cannot be established from these component results. Provider time-to-first-token, worker reconnects and sandbox lifetime are separate execution-layer measurements.

The fixes above are applied to the UI-preview checkout. No active worker/server was restarted and no account or model setting was changed.
