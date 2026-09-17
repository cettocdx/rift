# Release preview and panel fluidity follow-up

2026-09-08 · `codex/reference-ui-rebuild` · RIFT UI Preview checkout.

## Fixed in this pass

### Cold panels could hide the entire application

In the real production frontend, the first click on **Show workspace panel** temporarily replaced the sidebar and conversation with the application-level `Loading` status. This was reproduced before the fix, independently of development HMR.

The installed Next.js `lazy-dynamic/loadable` uses a Fragment around an SSR-enabled dynamic import when no loading component is supplied. The dock and its individual tool imports had no closer Suspense boundary. Their first suspension could reach the application boundary.

`WorkbenchBoundary` now contains that suspension at the dock, at each tab body, and at the mobile computer pane. The rest of the application remains visible. Per-tab boundaries also preserve the dock header when another tool loads. This keeps lazy loading; it does not eagerly ship Monaco and every tool on chat startup.

A regression test holds the lazy panel import unresolved, checks that the conversation and dock controls remain visible, and verifies draft node identity, text, focus and selection before and after resolving it. On the final production frontend, the composer was visibly present while Activity was still loading; Activity then appeared. Preview also opened without hiding the composer. A typed, unsent draft survived opening the panel and was cleared after verification.

### Geometry searches touched too much historical content

The scroll hook used to locate a reading anchor by reading every historical semantic block until reaching the viewport. The outline similarly read every user-message position on a scroll update. Both paths now binary-search the ordered message rows first. The scroll hook examines semantic blocks only in visible rows; existing anchors retain their fast path. Non-chat consumers without message wrappers retain their fallback behavior.

| Controlled regression scenario | Before | After |
| --- | ---: | ---: |
| Locate a reading anchor near the end of 200 messages × 20 paragraphs | 3,981 block rectangle reads | At most 30 rectangle reads |
| Locate the active outline turn among 200 user messages | 200 message rectangle reads | At most 10 rectangle reads |

These are instrumented DOM-method counts, **not FPS or network measurements**. Tests also verify that adding 240 px above the reader preserves the reading position and does not re-enable following. The search assumes the current non-overlapping, vertically ordered message rows.

### Dock motion repeatedly reflowed the transcript

The dock animated `width` and `height` for 220 ms. Every intermediate width could rewrap the conversation and refit embedded tools. Dimensions now commit once; the opened panel uses a 160 ms opacity reveal. There is no transform of native browser geometry, no intentional closing delay, and reduced-motion mode disables the reveal. Pointer resizing remains direct.

## Production frontend available separately

From this checkout:

```sh
pnpm build:ui-release-preview
pnpm start:ui-release-preview
```

The isolated cache is `.next-fluidity-release`; the server binds to `127.0.0.1:3022`. Stop that preview server before rebuilding its cache. The original **3020 development server and worker were not restarted**. No native application bundle was replaced and the existing desktop preview configuration still points to 3020. The new server is a production **frontend** preview using the existing configured backend, not a separate deployment or a native release benchmark.

Visit `http://localhost:3022/?riftPerf=1` for local diagnostics. The production probe requires an explicit build flag, a loopback hostname and the query parameter. It records timing, event types and bounded frame/task samples, never message text, keys typed, credentials or telemetry. Navigating to another route preserves the mounted probe, but a full reload on that route needs `?riftPerf=1` again.

## What the live measurements establish

Exploratory samples showed a development first-contentful-paint of 2,140 ms versus a production sample of 552 ms. A warmed development reload then reached 380 ms. These **are not a matched speedup ratio**: viewport changes, warming and background build work affected some samples. They demonstrate why development compilation cannot be used as a release-performance baseline. Exploratory samples collected during a build are excluded from acceptance results.

After the final build and tests completed, the production frontend was checked in Chrome on the saved Build conversation containing tools, a generated image and edited files. The measured DOM viewport was **1334 × 694**. A requested viewport override did not consistently reach that tab, so the report records the actual size rather than the requested size.

The final page load recorded a 118 ms response interval, 379 ms DOM-ready time and 420 ms first-contentful-paint. These are navigation metrics, **not time until all chat data or media are ready**.

The final Activity opening plus three repeated open/close cycles yielded:

- 323 interaction-window RAF samples; frame interval p95 **16.5 ms**.
- Maximum frame gap **275 ms**: isolated stalls remain.
- Five observed long tasks including startup; maximum **282 ms**.
- Reported interaction-event p95 **312 ms**, including the first opening/closing; this is not an official INP score.
- No whole-application loading fallback was observed on the final cold Activity or Preview opening; panel content and composer remained available.

The event samples include cold tool loading; they must not be presented as steady-state interaction latency. The desktop also had unrelated active CPU consumers. We did not stop user processes to obtain a cleaner number. The remaining spikes therefore need a controlled main-thread trace before assigning them to RIFT code or OS/browser scheduling. The fix removes repeated dimension animation by construction; these samples do **not** establish a matched numeric panel speedup.

The saved preview URL returned an E2B **Sandbox Not Found** page. Toolbar layout and panel continuity were checked, but this run does not verify that an expired remote sandbox can resume. No task, terminal command or model request was submitted.

## Verification and limits

**60 tests passed in nine suites**, covering outline navigation, reading anchors, hover/list behavior, transcript rendering, image-cache deduplication, lazy-panel isolation and dock persistence/controls. The final Next production build, including TypeScript checking, passed.

Cursor/Claude native parity remains unproven. Still required: a matched native WebView trace, sustained real worker output in that release environment, input-delay attribution for the remaining individual stalls, and foreground/background transitions. This pass fixes measured code defects and creates the production-frontend comparison path; it does not claim zero frame drops or zero model latency.
