# Actual dock under sustained output

The transcript fixture now supports the real `WorkbenchDock`, its dock hook,
Activity body and live sidebar provider alongside actual Messages,
useMessageScroll, Markdown and code highlighting. Fixture state replaces network
services and rejects attempted application mutations. Chat wrappers reproduce
right/bottom placement, resizing defaults, hidden panels, and maximized
conversation `display:none`/`inert` behavior. Browser, terminal and preview panel
contents themselves are outside this fixture's coverage.

Four desktop correctness cases passed in Chromium and WebKit: reading and
following while one assistant text part receives sustained code/prose updates
and a held local image completes. The real toolbar moves, maximizes, restores
and hides the dock. Reader drift was zero, following ended at the bottom, exact
code and all paragraphs remained present, and typing retained its draft/focus.
There were no page errors or attempted application service calls.

The initial four cases used metadata-free synthetic history. Their RAF samples
also included screenshot overhead and overlapped host TypeScript work. Those
timing results are not production performance evidence. The recorder now stops
before screenshots, including a guard against an already scheduled callback.

A subsequent quiet WebKit pair used realistic completed-history token metadata
and user boundaries. Both cases began with Activity open and received identical
chunks. One kept the panel stable; the other performed dock transitions at fixed
chunk counts. Trace recording and automatic screenshots were off during the
measurement. Both cases passed all correctness checks.

| RAF interval, milliseconds | Stable panel | Dock transitions |
| -------------------------- | -----------: | ---------------: |
| Median                     |           17 |               17 |
| 95th percentile            |           21 |               23 |
| 99th percentile            |           58 |               78 |
| Maximum                    |          145 |              309 |
| Gaps above 50ms            |            6 |                6 |

The transition case had 78ms and 60ms gaps near restoration of the conversation.
The largest 309ms gap occurred at final output completion, about 2.8 seconds after
hiding the dock, rather than at a panel action. This single ordered pair does not
establish causality, universal fluidity, native WKWebView behavior or parity with
Cursor/Claude. It identifies restoration and final completion as the next
profiling targets. No runtime optimization is claimed from adding this fixture.

Evidence: `/tmp/rift-real-workbench-evidence/final4` and
`/tmp/rift-real-workbench-evidence/paired-final`. The separate fixture selector
and media-target mistakes are archived as test setup failures, not app defects.

Reproduce correctness using the maintained transcript fixture config and
`--grep 'actual workspace'`; its desktop projects run these cases and mobile
projects explicitly skip this desktop dock scenario. Setting
`RIFT_WORKBENCH_PAIRED=1` selects the two reading cases with realistic history.
Use a quiet host, disable tracing, and inspect the recorded action/frame
timestamps before interpreting timing differences.
