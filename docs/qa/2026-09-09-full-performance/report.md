# RIFT performance verification — 9 September 2026

**Overall result: FAIL for the fluidity target.** Functional checks passed and a measured Chromium streaming bottleneck was fixed. Sustained WebKit rendering and isolated navigation/panel stalls still fail the intended desktop experience. This report does not certify parity with Cursor, Claude or Codex.

## Method and environments

Acceptance was recorded in [plan.md](plan.md) before the runs: no lost input/output/reading position, interaction event p95 ≤100 ms, frame interval p95 ≤33.4 ms, and explicit reporting of worst cases. Tests ran on the user's Mac with other applications present. Final renderer repeats ran sequentially without simultaneous builds. This is a development workstation, not an isolated performance lab.

- Production RIFT frontend: `localhost:3022`, built with `pnpm build:ui-release-preview`; live walkthrough at 1280×720.
- Component stress replay: production React bundle using the actual transcript/Markdown components; Chromium 140.0.7339.16 and Playwright WebKit 26.0, 1200×800. Services are isolated, so these results exclude model/network/worker latency.
- Installed **RIFT UI Preview**: native shell still connected to the development frontend at `localhost:3020`. Xcode Instruments measured this separately. Playwright WebKit is not the installed WKWebView.
- Real console: `packages/console/dist/index.js`, Node 22.23.1, authenticated service at `localhost:3020`.

## Sustained streaming results

The fixture contains 200 completed history rows, 60 tool entries, 60 reasoning entries and 180 Markdown sections with links, tables and code. Mixed replay requests 1,200 updates; code replay requests 600 updates with 1,800 code lines. The requested update interval is 25 ms. Typing, hover, keyboard actions and panel controls are exercised during output.

| Chromium scenario | Before: median elapsed | After: median elapsed | Before frame p95 | After frame p95 | After worst frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mixed, 3 runs each | 35,953 ms | 31,125 ms | 16.8 ms | 16.7–16.8 ms | 16.8 ms |
| Code, 3 runs each | 21,150 ms | 16,873 ms | 33.3 ms | 16.8 ms | 66.8 ms |

Elapsed replay time fell **13.4% for mixed output** and **20.2% for code**. This is rendering/replay improvement, not faster model generation. Final event p95 was 16 ms for mixed and 24 ms for code. Mixed runs had no frames over 50 ms; code runs had 1, 0 and 1 respectively. All six runs retained the input, original link DOM, final text and code. No >50 ms long tasks were reported in these Chromium repeats.

Raw evidence: `mixed-1.json` through `mixed-3.json`, `code-1.json` through `code-3.json`, and the corresponding `final-*` files in this directory.

### WebKit is the major remaining failure

The clean final mixed replay took **132,339 ms**, with frame p95 **149 ms**, p99 **161 ms**, and maximum **206 ms**. Of 1,427 sampled frame intervals, 1,196 exceeded 50 ms and 713 exceeded 100 ms. Input and final output remained correct, but the rendering target of 33.4 ms was missed substantially. See [webkit-verified-final.json](webkit-verified-final.json).

An earlier baseline measured p95 181 ms and elapsed 170,440 ms; a short profiling sample overlapped that diagnostic run. It is not a clean basis for a precise before/after percentage. The final failing measurement has no overlapping profiler. Unsupported WebKit event, long-task and heap metrics are recorded as `null`, not zero.

## Fix made and verified

CPU profiling identified repeated Markdown link repair as an expensive path: remend rescanned preceding code fences for each link on each text delta. A conservative linear check now skips only link/image repair when the text has complete, unambiguous link syntax. Incomplete links, escapes, HTML and uncertain syntax retain the existing library path. Sanitization remains in place.

Implementation: `lib/ui/markdown-link-repair.ts`, used by `app/components/MemoizedMarkdown.tsx`. Regression tests exercise complete links followed by incomplete streamed syntax. Comparison against the installed remend implementation produced **identical results for all 20,000 deterministic examples**; 1,617 used the fast path. This is broad regression evidence, not a proof for every possible Markdown string.

A separate block-only parsing experiment failed to improve WebKit performance and was removed, including its temporary dependency. Its diagnostic files are labelled `rejected-block-parser-*` and are excluded from final results.

## Real application walkthrough

[live-production-ui.json](live-production-ui.json) records the opt-in DOM performance probe. Production first contentful paint was **308 ms** in this one startup sample; response time was 137 ms and DOM ready 273 ms.

| Cumulative walkthrough checkpoint | Event p95 | Worst observed event | Frame p95 | Worst frame | Long tasks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Composer menus and first Activity opening | 56 ms | Not retained | 9.3 ms | 26 ms | 1 |
| Activity, Browser and Terminal | 80 ms | 160 ms | 9.3 ms | 101 ms | 4 |
| Main routes and nine Settings sections | 80 ms | 264 ms | 9.3 ms | **416 ms** | 28 |

The longest task was 372 ms. These worst cases matter even though aggregate p95 looks good. Per-route attribution was not retained, so the 416 ms interval cannot honestly be assigned to a particular Settings page. The cumulative layout-shift total of 0.514 spans SPA navigation and is **not a per-page CLS score**.

Event Timing reports only events above its reporting threshold; these percentiles are not official INP. Frame sampling covers the 700 ms following interactions and excludes idle/background gaps. These checkpoints were captured before Instruments recording. A later automation timeout during trace processing is excluded rather than counted as a RIFT failure.

Visited and exercised: Build and six composer menus; Activity repeated opening/closing; Browser empty state; Terminal input; Plugins search; Agents bot selection; Runs, Tasks and Artifacts lists; Studio category selection; Hack Workbench drawer and draft; all nine Settings sections. No production console errors were observed. Main input was retained across dock actions and the console input was independent.

This is screen and interaction coverage, not verification of every operation those screens can perform. No security assessment, purchase, account-setting change or old-run retry was performed.

## Continuity, scrolling and CLI

- A real Gemini 3.8 Flash task generated 120 numbered lines. While it streamed, navigation visited Plugins, Agents, Runs, Tasks and Artifacts. Returning showed all **120 lines and the final marker**, with the run finished. RIFT reported 27 seconds and $0.02. Reviewable conversation: `680bbdfb-82ec-4eef-8d31-0eb081098dfb`, **Performance Verification Test**. This verifies one live navigation scenario; it does not establish exact time to first token or general outage recovery.
- Delayed-image and panel-layout fixture: **0 px reading-position drift**, reserved image height remained 360 px, transcript retained, and bottom gap stayed zero. See [scroll-layout-dev.json](scroll-layout-dev.json). This fixture runs on development3020; production deliberately returns 404 for this lab route. The initial production-fixture attempt was unavailable, not an application scrolling failure.
- Real PTY console retained `Akıcılık testi: ğüşöçıİ 12345`, opened `/help`, dismissed it with Escape, and exited `/quit` with code 0. No model task was submitted in the console. Existing authentication was used at3020; the initial3022 attempt correctly required sign-in.
- Console renderer CPU benchmark: 1,000 history entries, 1,000 live lines, 300 measured renders at each of 80×24, 126×46 and 180×60. Render p95 ranged **0.060–0.074 ms**. This excludes PTY transport, screen paint and provider latency; it is not an end-to-end keystroke latency claim. See [console-renderer.json](console-renderer.json).

## Installed desktop and competitors

A 30-second Instruments Animation Hitches recording covered native Activity opening/closing and effort-menu dismissal. Reported hitch intervals reached **341.7 ms**; 9 exceeded 50 ms and 4 exceeded 100 ms. These records are hitch intervals, not a complete frame census or FPS measurement. Profiling overhead, a development frontend and other user applications were present; parent-process tracing does not fully attribute child WebContent CPU. See [native-instruments.json](native-instruments.json).

Cursor and the official Claude desktop application were opened for a qualitative inspection after RIFT benchmarks. Cursor's AgentPanel displayed an error at inspection time; Claude opened in Code mode. No matched healthy-state timing series was collected for either. **No comparative performance win or parity claim is supported.** Full Instruments traces remain local in `/tmp`; their environment metadata is intentionally not included in this report.

## Verification and remaining gates

| Check | Result |
| --- | --- |
| Production build and TypeScript | Pass |
| Focused frontend regression suites | 55 tests passed, 10 suites |
| Console regression tests | 51 passed |
| Effort dismissal, normal/reduced motion | 6 cases passed |
| Markdown equivalence | 20,000 cases passed |
| Chromium sustained frame p95 | Pass; code still has isolated slower frames |
| WebKit sustained frame p95 | **Fail** |
| Uniformly smooth route/panel opening | **Fail: stalls remain** |
| One live task across route navigation | Pass |
| Matched production-native competitor benchmark | Not completed |
| All providers, offline/reconnect, sleep/wake, overnight soak | Not covered by this run |

The build has an unresolved Turbopack broad-file-tracing warning in the MCP registry/catalog import chain. It does not fail compilation; packaging impact still needs investigation.

Next priorities are (1) WebKit's sustained parsing/rendering work, (2) attribution and removal of first-panel/route stalls, (3) a native production build followed by matched desktop repeats, and (4) separately instrumented provider latency and interruption recovery. Do not obscure failure states to make the interface appear successful.

## Reproduction

Run from `/Users/cetto/.codex/worktrees/rift/reference-ui` with installed dependencies. Keep builds and profiling separate from measured repeats.

```sh
pnpm build:ui-release-preview
pnpm start:ui-release-preview
node scripts/verify-stream-fluidity.cjs optimized mixed 1200
node scripts/verify-stream-fluidity.cjs optimized code 600
RIFT_PERF_ENGINE=webkit node scripts/verify-stream-fluidity.cjs optimized mixed 1200
node --experimental-strip-types scripts/verify-markdown-repair.mjs
RIFT_SCROLL_TEST_URL=http://localhost:3020/lab/scroll node scripts/verify-scroll-layout.cjs
node scripts/verify-effort-dismissal.cjs
pnpm --dir packages/console test
node scripts/verify-console-performance.mjs
```

Start the production server in a separate terminal, and repeat each Chromium scenario three times. The final JSON files are the measurements from this run; rerunning now measures the retained fix, not the earlier baseline. See [functional-summary.json](functional-summary.json) for the consolidated functional evidence.
