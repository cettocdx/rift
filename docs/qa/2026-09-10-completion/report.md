# RIFT reliability and fluidity verification — 2026-09-10

## Verified in this pass

- Isolated Local runner network outage: 90 seconds; 60/60 output markers received, zero duplicates, one command execution.
- SIGKILL of isolated launcher: retained connection identity; original detached command completed once. A subsequent command completed; cancellation returned exit 130 without the trailing marker.
- Recovery tests: 21 tests across four suites passed. CLI tests: 56 passed; OpenTUI: 10 passed, 46 assertions. Real installed `rift` opened from `/tmp`, accepted Turkish input and `/help`, and Ctrl+C exited with code 0.
- Unfinished code fences now render escaped plain text directly instead of repeatedly parsing the whole growing fence; syntax highlighting resumes after completion within the existing size budget.
- Final WebKit streaming fixture (200 history rows, 600 updates): p95 21 ms, p99 22 ms in both repeats; maximum 43 / 23 ms; zero frames above 50 ms. Baseline maximum 391 ms, nine frames above 50 ms. These are bounded synthetic results, not whole-application or competitor parity.
- Media/panel scroll fixture: 0 px drift; transcript retained; image allocation stayed 360 px.
- Production build and targeted rendering lint passed. Markdown-related suites: 16 tests; fence/large-output suites: 9 tests (overlapping tests, do not sum).
- localhost:3020 now runs a production build through macOS LaunchAgent `app.riftsys.ui-preview-web`, RunAtLoad and KeepAlive. HTTP 200 confirmed. RIFT UI Preview reloaded successfully. Trigger worker was not stopped.

## Still open / not proven

- Initial response remains 11.2–14.5 seconds over three persisted greeting samples. Admission 2.2–3.0 seconds; model first-text waiting remains a material contributor. No claim that startup latency is fixed.
- Arbitrary command worker death or machine reboot cannot transparently resume shell processes. Safe non-replay is necessary when side effects are uncertain.
- Actual OS sleep, overnight outages, and all UI screens under sustained real work have not been exhaustively validated.
- Full CLI parity for project bots, Studio and all app tools is not established by the input/exit tests.
- This is a local production frontend, not a signed public release. Trigger worker remains a development worker.
- After production reload the active task remained visible in the sidebar; this does not alone prove every live transcript event reattached correctly.

## Evidence

- `outage-90s.json`, `recovery-tests.log`, `cli-tests.log`
- `webkit-before.json`, `webkit-fast-fence.json`, `webkit-fast-fence-repeat.json`
- `scroll-layout.json`, `startup-before.json`, `production-final.log`
