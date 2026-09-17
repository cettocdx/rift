# RIFT performance follow-up — 2026-09-09

## Implemented

- Streamdown now receives a renderer-local incremental block parser. Previously, every delta lexed the entire growing Markdown document. Completed blocks are retained and the last two nonblank blocks remain mutable. Replacement text invalidates the cache. HTML, math, reference definitions, footnotes and CR newlines conservatively use the upstream full parser.
- Empty terminal drafts no longer force a synchronous scrollHeight layout read on mount. Nonempty multiline drafts retain autosizing.
- Pointer or keyboard intent prepares the workbench shell and requested view concurrently. This imports code without mounting panels, connecting terminals or submitting tasks. Failed warmups remain retryable.

## Stress measurements

Same synthetic fixture: 200 history rows, mixed text/tool/reasoning output and sustained input, hover and keyboard interactions; 1200 mixed updates or 600 code updates; 1200×800 viewport. All listed runs passed draft, text, code, link and disclosure assertions. These are browser-engine stress tests, not a native competitor comparison.

| Run | Duration | Frame p95 | Worst frame |
| --- | ---: | ---: | ---: |
| chromium-code-1 | 17.55 s | 16.8 ms | 100.0 ms |
| chromium-code-2 | 17.88 s | 16.8 ms | 83.3 ms |
| chromium-code-3 | 17.55 s | 16.8 ms | 233.3 ms |
| chromium-mixed-1 | 30.74 s | 16.8 ms | 83.4 ms |
| chromium-mixed-2 | 34.36 s | 16.8 ms | 716.6 ms |
| chromium-mixed-3 | 31.34 s | 16.8 ms | 66.7 ms |
| webkit-code | 20.27 s | 32.0 ms | 236.0 ms |
| webkit-mixed-1 | 34.54 s | 24.0 ms | 261.0 ms |
| webkit-mixed-2 | 33.15 s | 25.0 ms | 226.0 ms |
| webkit-mixed-3 | 37.22 s | 30.0 ms | 683.0 ms |

Prior clean WebKit mixed baseline was 132.34 s with frame p95 149 ms. New mixed median is 34.54 s (about 74% shorter), with p95 24–30 ms. All current engine runs meet the 33.4 ms p95 target. This does not mean every frame meets the target: Chromium reached 716.6 ms and WebKit 683 ms in individual runs.

The machine was not isolated: WindowServer, another Next server, Codex, filesystem scans and other user processes were active. These processes were not stopped. No result was discarded for being slow. Regex instrumentation was used only for diagnosis and is excluded from this table. The fixture retains its existing width-transition stress behavior.

## Correctness verification

- 11,897 comparisons against the upstream Markdown parser passed, including remend-transformed prefixes, replacement text and grammar edge cases. The append-only history check parsed only 63 trailing characters after 11,840 previous characters.
- 77 Jest tests passed across 7 relevant Markdown, terminal, run-summary, browser and panel-boundary suites.
- Targeted git diff whitespace checks passed.

## Limits and remaining work

- The optimization deliberately falls back for context-sensitive Markdown. HTML-heavy responses may still require whole-document parsing.
- Cold terminal and native app performance must be assessed separately from streaming throughput. No Cursor/Claude/Codex numerical parity claim is established.
- Isolated long frames remain and need further attribution under controlled machine load.
- These tests do not certify network/model latency, cloud recovery, every app screen or every historical feature request.

## Production verification

The production build passed, including TypeScript, and the updated server was restarted at http://localhost:3022. The user’s development server at 3020 was not stopped.

Live authenticated browser check: terminal opened; empty console input measured 20 px and a two-line draft measured 39 px; panel hide/reopen worked. Test drafts were cleared, and no agent task was submitted.

Single cold terminal click event duration was 320 ms, versus 488 ms in the earlier snapshot. This is not a controlled repeated comparison and is not sufficient to attribute a precise gain. Current navigation FCP was 4832 ms, longest task 392 ms, and one interaction frame gap was 225 ms. Cold startup and isolated stalls remain unresolved performance targets. The pointer warmup is covered by behavior tests but its independent live benefit has not been isolated.

The production build still reports the existing broad file-tracing warning in the MCP catalog/Next configuration path. It completed successfully; that warning was not addressed by these changes.


## Follow-up: closed terminal layout work

Found that TerminalDock installed global mutation, resize and scroll observers even before the terminal was opened. With no terminal host, every observed chat mutation scheduled another layout measurement. The host-tracking effect now runs only while terminalDockOpen is true; closing disconnects observers and cancels queued animation frames. Reopening measures the current host before paint, without unmounting the terminal session.

A regression test first failed on a geometry read while closed, then passed after the change. It also checks observer cleanup and preservation of the same terminal session across close/reopen with a newly inserted host. 56 tests passed across TerminalDock, RiftConsoleView and WorkbenchDock. This proves elimination of the unused observer path, not an app-wide latency percentage.

Production rebuild passed and the updated 3022 server was restarted. Live authenticated terminal open/hide/reopen passed. A single current sample recorded FCP 1340 ms, terminal click 304 ms, longest task 170 ms and worst interaction frame 183 ms. These are observations, not a controlled before/after claim; cold terminal opening still misses an instant-response target.


## Standalone shell and terminal warmup correction

Desktop shell sessions may now omit a workspace grant. The native command resolves the OS user home directory; it does not accept an arbitrary ungranted path. Supplied grants still go through the existing writable-folder resolver, and non-shell profiles still require a grant. The native response supplies actual cwd to the UI. The shell UI no longer disables New terminal or displays a mandatory-folder banner when no workspace is selected.

The terminal intent preloader also incorrectly imported ComputerSidebar, although terminal tabs render a persistent TerminalDock host. It now prepares the actual terminal module, eliminating the unrelated detail-renderer import. No precise latency reduction is claimed without a new comparable measurement.

19 tests passed across the native service contract, terminal panel and warmup regression suites. Cargo check and the debug desktop build passed. The correctly identified RIFT UI Preview bundle was updated, ad-hoc signed, signature-verified and reopened. No terminal child process was present before restart. Actual native PTY command execution without a grant remains to be verified through the desktop UI; compile and mocked contract tests alone do not establish that end-to-end result.

Final web production rebuild passed and 3022 was restarted. In the updated native app, terminal tab selection reached an interactive terminal input without the mandatory-folder banner. During verification the foreground UI moved to execution-target/settings controls, so no command was typed into a potentially changed user target. Native shell process execution and repeated first-open latency remain unverified.

## Native shell execution and visibility lifecycle verified

The initial live `grantId: null` error came from an old running executable inode, not the newly built file on disk. After a confirmed quit and relaunch of RIFT UI Preview, a native shell opened without a workspace grant in `/Users/cetto` and executed a command with `SHELL_READY` output.

A separate lifecycle regression was found: a zero-size hidden host set terminalReady to false, which cleaned up the native session and input drain. Geometry changes now only control fitting; a running PTY stays alive until its component is closed or restarted. The new component regression test failed first because kill was called when hiding the host, then passed. It checks one creation, no kill on hide/show, working input after return, and cleanup on unmount. All 20 tests across four targeted suites passed; the production build (including TypeScript) passed and port 3022 was restarted with it.

Actual native verification: set `RIFT_VERIFY=preserved`, switched from Terminal to RIFT console and back, then ran `typeset -p RIFT_VERIFY`. The native terminal returned `typeset RIFT_VERIFY=preserved`, confirming shell state and input survived the view switch. Native window activation was required to distinguish WebKit background rendering suspension from a blocked PTY; a process sample did not show a native main-thread deadlock. Further whole-panel hide/reopen testing was stopped when computer use reported user changes to the app. The prior unverified execution notes above are superseded by this command evidence, but no new repeated first-open latency or competitor-parity claim is made.
