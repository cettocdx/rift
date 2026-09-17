# Mobile workspace targets — review evidence

Base: 8376e811ffe968cf826dfe5367c14cf6be51ce7d
Worktree: /tmp/rift-mobile-targets-worktree
Branch: codex/mobile-targets-20260911
Patch: /tmp/rift-mobile-targets.patch
SHA256: 263c946e4183b90c8868f04657c0ba85d94e381157df60e5ea02dcd2cd5800db

## Results

- Red production-component matrix before CSS fixes: 8 failed, 0 passed, 0 skipped. Report /tmp/rift-mobile-targets-red.json; start 2026-09-11T02:07:12.383Z.
- Final full matrix: 112 passed, 0 skipped, 0 unexpected, 0 flaky. Report /tmp/rift-mobile-targets-worktree/e2e/mobile-fixture/results/workspace-targets/report.json; start 2026-09-11T02:15:32.022Z, duration 120370.666ms.
- Final command: pnpm exec playwright test --config e2e/mobile-fixture/playwright.workspace-targets.config.ts
- Existing RunsWorkbench, TaskCenter, ProjectBotsWorkbench, AppearanceSettingsTab Jest regressions: 4 suites / 52 tests passed.
- Full pnpm exec tsc --noEmit --incremental false passed.
- Scoped ESLint, git diff --check, patch reverse-apply check passed.

## Before and after

- Runs filters: 28px high -> at least44px coarse.
- Tasks Create32px / filters30px and dialog controls -> at least44px coarse.
- Agents project select26px / create28px / Addbot35.5px and dialog controls -> at least44px coarse. WebKit native select has unchanged19px fine baseline.
- Appearance range16px ->44px coarse. Actual top3px/bottom3px touchscreen taps change both native ranges in both engines.
- Color input40px clipped inside20px frame -> fully contained44px coarse input. Fine swatch frame remains20px.
- WebKit fine long catalog: overlay scrollbar covered2/5 Close hit points. Moving this dialog’s close button from right8px to16px clears the scrollbar without changing its24px fine size.

## Scope and limits

Four actual production components and styles, real shared controls/dialogs and local UI interactions; fixtures isolate auth/subscription/navigation/Convex reads. One completed run and one project, empty tasks/bots. All synthetic backend mutation/action attempts are counted, throw, and fail cases; no remote writes or provider calls. No environment files, credentials, real account mutations, runtime changes, build, commit or deployment.

112 cases: Chromium and WebKit, 360/390/430 widths with coarse and fine pointers plus1200px fine desktop, dark/light, four views. Geometry checks include visible bounds, user-scrollable ancestor revelation, clipping and five-point hit testing. Local filter changes, opening/closing real dialogs, local task draft, local color change and range changes are exercised. Populated task/bot row actions, advanced agent/profile editors, OS native color picker and physical mobile keyboards are not covered. This is component-fixture evidence, not the formal authenticated mobile release gate.

Screenshots/geometry are attached in the final report. Extra color screenshot: /tmp/rift-mobile-color-targets.png. Fine catalog before screenshot: /tmp/rift-fine-agent-catalog.png.

The reviewed patch excludes dependency symlinks and generated test results. It was subsequently integrated into `/Users/cetto/RIFT-Release` on top of `19cdde9`. All 24 integrated cases passed for Chromium 390px coarse and WebKit 390px coarse/fine with the strengthened acceptance geometry helper (`/tmp/rift-mobile-targets-integrated.log`). Independent review found no blocker in the final patch, including the native-range pointer tests and explicit attempted-write counter.
