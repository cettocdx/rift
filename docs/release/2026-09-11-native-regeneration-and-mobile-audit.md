# Native regeneration and mobile audit — 2026-09-11

## Actual native regeneration

Used the ordinary Regenerate response control in `/Applications/RIFT UI Preview.app` on the dedicated greeting QA conversation `77ab987f-735f-42a6-a31d-b39ccb53f2f6`. The replacement response completed, the Active entry disappeared, and Command+R preserved one user message and the new assistant response, without an error overlay. This checks the native UI path, including removal of the preceding assistant response; the earlier API-only regeneration check did not cover that removal.

Local screenshot: `/var/folders/wx/z8k5q55n7p3_xclljxndysv80000gn/T/codex-shot-2026-09-11_04-59-42.png`. This is one short greeting, not a long-workload or all-screen performance acceptance.

## Mobile evidence and remaining gaps

- The current release passed all 12 public mobile login/signup cases across Chromium and WebKit. Report: `e2e/mobile-public/results/report.json` (ignored local artifact).
- An existing authenticated Chrome session was inspected on 18 routes at 390×844, including all nine Settings sections. No document overflow was observed. The original page and viewport were restored. Evidence: `/tmp/rift-mobile-readiness-audit-20260911.json`.
- That Chrome session had a **fine pointer**. Responsive viewport inspection does not establish coarse-pointer or physical-device behavior. No credentials were extracted or authentication bypassed.
- The acceptance geometry helper previously accepted any nonzero size. New negative regressions demonstrated that reachable 20px coarse-pointer buttons incorrectly passed. The helper now requires actual 44×44 CSS-pixel targets for coarse input, preserving the fine-pointer policy and all clipping/overlay checks.
- All 22 harness cases passed across both engines, including two expected failures proving undersized targets are rejected. Red log: `/tmp/rift-mobile-target-red.log`; green log: `/tmp/rift-mobile-target-green.log`. Changed-file ESLint and `git diff --check` passed.

The authenticated 132-case suite remains unexecuted without an ordinary logged-in Playwright storage state. Harness tests and the manual fine-pointer audit do not substitute for it. Runs/Tasks/Agents compact actions and Appearance sliders/color inputs require real-component coarse-pointer verification and fixes. Keyboard obstruction, draft preservation, menu navigation and recovery still require full authenticated mobile journeys.
