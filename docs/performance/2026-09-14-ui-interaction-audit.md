# UI interaction audit — 14 September 2026

## Changes

- Hack Workbench target input uses 16px on narrow (up to 800px) or coarse-pointer devices, consistent with the composer. Desktop compact sizing remains unchanged.
- Question-card free-text answers use 16px/24px on the same mobile/touch boundary. Keyboard focus gets an explicit outline around the custom-answer group.

## Verification

- Transcript production-component browser fixtures: 72 passed, 16 scenario-specific skips, Chromium and WebKit at 360/390/430px and desktop. Covers delayed media, appended output, panel reflow, route retention, keyboard-sized layout changes, streaming Markdown/code completion and sustained desktop output. Service boundaries are mocked; these are not live agent runs.
- Mobile navigation/scroll fixtures: 8 passed in mobile Chromium/WebKit.
- Terminal fixtures: 8 passed across desktop/mobile, light/dark, Chromium/WebKit. Each exercised over 13MB output with bounded scrollback, input and Ctrl+C during output, hide/resize, retained draft and final output. Transport is a fixture, not a live shell service. Passing behavior assertions do not establish a frame-time SLO.
- Production CSS checked in WebKit: target and answer fields 16px at 360/390/800px; compact 13px at 1200px; no horizontal overflow, explicit focus outline. This checks CSS geometry, not a physical iOS keyboard.
- Production build passed. Publication status is recorded separately in the preview release log.

## Bounds

This pass does not establish whole-app parity with another product or absence of all UI defects. Physical-device keyboard/safe-area behavior, live long-running agent workloads and whole-app route coverage remain separate acceptance work. The earlier localhost `/lab/scroll` timeout was an unavailable fixture route; the isolated fixture server successfully exercises that production scroll component.
