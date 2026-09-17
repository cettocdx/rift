# Mobile responsive verification — 2026-09-11

Scope: the source checkout at `/Users/cetto/RIFT-Release`. This pass inspected the mobile shell, composer, navigation/workbench tests, and Playwright mobile configuration. No servers were started or restarted; no native application or authenticated account state was changed.

## Fixed: composer focus before mobile detection

`useIsMobile` intentionally starts with `undefined` for hydration. `ChatInput` previously passed `autoFocus={autoFocus ?? !isMobile}`, treating that unknown state as desktop. React focused the textarea during its first commit, before the effect resolved the mobile breakpoint. Resolving the hook to `true` did not remove the existing focus.

Real `ChatInput` integration tests reproduced the wrong focus at 360, 390, and 767 CSS pixels. Desktop cases at 768 and 1280 pixels already passed. The fix waits for `isMobile === false`; `ChatInputTextarea` completes deferred desktop focus once, only while the document body still owns focus. Explicit autofocus opt-in and opt-out remain supported. These tests establish DOM focus behavior; they do not establish physical-device keyboard behavior.

Changed implementation: `app/components/ChatInput/ChatInput.tsx`, `app/components/ChatInput/ChatInputTextarea.tsx`. Regression coverage is in `app/components/__tests__/ChatInput.integration.test.tsx`.

## Executed validation

- Initial mobile/responsive selection: **9 suites, 45 tests passed**.
- Before the fix, new initial-focus cases: **3 failed** at phone widths, **3 passed** for desktop widths and explicit opt-out.
- After the fix, mobile/responsive + composer integration + palette + draft lifecycle + input performance selection: **13 suites, 102 tests passed**. Includes eight initial-focus cases (five widths, explicit opt-out, preserving an already-focused control, and explicit mobile opt-in).
- ESLint passed for all three changed source/test files; scoped `git diff --check` passed.
- Playwright mobile test discovery passed: **71 collected entries**, including three authentication setup entries and 34 tests each for Mobile Chrome (Pixel 7) and Mobile Safari (iPhone 15). Discovery is not execution.

Commands:

```sh
pnpm exec jest --runInBand --testPathPatterns='mobile|responsive-contract|ChatInput.integration|ComposerPalette.test|useComposerDraft|InputContext.performance'
pnpm exec eslint app/components/ChatInput/ChatInput.tsx app/components/ChatInput/ChatInputTextarea.tsx app/components/__tests__/ChatInput.integration.test.tsx
pnpm exec playwright test --project='Mobile Chrome' --project='Mobile Safari' --list --reporter=list
```

## Coverage and remaining verification

Existing component tests cover mobile app-bar sizing and route titles, drawer semantics and route changes, workbench navigation and terminal selection, header actions, artifact interactions, composer target classes/safe-area declarations, and palette calculations against a simulated visual viewport. Some responsive tests assert source/class contracts rather than browser layout; neither these nor jsdom reproduce Safari's software keyboard, safe-area geometry, text zoom, or real touch input.

The authenticated Playwright mobile runs were not executed in this bounded source pass. `.env.e2e` and `e2e/.auth` were absent; fixtures fall back to default test users. The default server URL is localhost:3010, which was not running, and the configuration would start `pnpm dev:next`. The already-running 3020/3022 previews were not rebuilt against this change, so they cannot establish validation of the modified release source. Run against the current release build with verified test accounts before claiming full mobile end-to-end coverage.

The discovered end-to-end specs focus on paid/free chat, attachments, pinning, and chat switching. They do not provide dedicated all-route responsive geometry checks for Agents, Plugins, Runs, Tasks, Notebook, Studio, and Settings, or a real-device keyboard/rotation pass. Those remain explicit release verification gaps, not established product defects.
