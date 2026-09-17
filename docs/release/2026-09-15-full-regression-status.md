# Full regression status

## Latest full rerun after exit-receipt retry

`/tmp/rift-full-regression-0915-current.log`: 795 suites, 792 passed and
3 failed; 8,108 tests, 8,061 passed, 46 failed, 1 skipped; all 24 snapshots
passed. Duration 441.089 seconds. The previous four contract/timing failures
did not recur. All remaining failures are in `git-operations.test.ts`,
`git-status-command.test.ts`, and `sandbox-fs-commands.test.ts`, where real
commands invoke `/usr/bin/python3` and the Apple SDK license gate returns 69.
This is still a failed full-suite gate, not a green release candidate.

Production route checks on 3052: `/studio` HTTP 200 (2,188 ms), `/hack` HTTP
307 to login (362 ms), `/workspace` HTTP 307 to login (445 ms). Anonymous
Studio rendered marketing content, not an authenticated Studio session.
Chrome at 390 and 1440 px observed no horizontal overflow or uncaught page
errors on that public content. These checks do not verify generation, file
downloads, Hack assessments, or authenticated mobile workflows.

The development `/studio` request exceeded its 10-second observation deadline
while Next was compiling that route. This is separate from cloud task liveness
and from the production timings above; do not classify it as a worker crash.

## Earlier run and fixes

Full Jest run: `/tmp/rift-full-suite-current.log`, 294.927 seconds. 795 suites: 788 passed, seven failed. 8,105 tests: 8,054 passed, 50 failed, one skipped. This is not a green release gate.

Four failing tests were inspected separately:

- Worker module timing probe had been preceded by a new import. Moved the leaf timing import back to first position, preserving its measurement boundary.
- Native toolset and lazy-integration structural tests still expected standaloneGreeting; implementation uses toolFreeTurn = standaloneGreeting || standaloneText. Updated structural checks to assert the combined gate, preserving non-tool-free tool availability.
- Project authorization is now inside awaited parallel setup instead of the old sequential assignment. Updated the wiring locator to the actual project resolution expression before tools and sandbox preparation.

Follow-up: 66 tests passed across timing/native contracts/standalone text (`/tmp/rift-contract-followup.log`). Project wiring/cleanup-scope follow-up in `/tmp/rift-wiring-followup.log`.

Three remaining failing suites exercise real Workbench filesystem/Git command execution. Apple system developer tools exit 69 because Xcode/Apple SDK license acceptance is outstanding; `/usr/bin/git --version` independently reproduces that error. Homebrew Git used by the outer shell still works. Do not weaken the bounded executor's PATH or skip its safety tests to report a green suite. Xcode 27 license acceptance also blocks native simulator tests. No license was accepted on the account owner's behalf.

Full suite must be rerun after the environment is ready. Unit/contract coverage does not replace multi-hour resilience, native UI acceptance, signing or production deployment evidence.

## Production build and CLI follow-up

- Separate production output `.next-release-audit-0915` built successfully; compilation 41s and 131 static pages generated. Log `/tmp/rift-production-build-audit.log`. The running 3046/desktop outputs were not replaced.
- Targeted ESLint for mobile API, GitHub completion, terminal implementation/tests and updated structural contracts passed (`/tmp/rift-release-lint-audit.log`).
- Real Bun/OpenTUI suite: 13 passed, zero failed, 73 assertions (`/tmp/rift-tui-release-audit.log`). Includes Ctrl+C idle/work/second-press, question selection/draft preservation, effort preview/commit, reduced motion and streaming cache behavior. These are TUI renderer tests, not a clean-machine CLI install.
- Production server on isolated 3052: Chrome checked /login, /signup and /pricing, all HTTP 200 with correct page titles. At 390px login had no horizontal overflow and no uncaught page errors. No sign-in or paid operation was dispatched by this smoke check.
- The twelve project-wiring/cleanup follow-up tests passed. Build-added audit dist include entries were removed from tsconfig to avoid committing machine-specific generated-output references.

The original full Jest run still includes the system-tool failures. Native, physical-device and full release acceptance remain open.

## Xcode toolchain restored (midday)

After the user's Xcode installation/license completion, the same three Workbench suites were rerun without weakening PATH restrictions or skipping tests: 49 tests passed, 3 suites passed, 100.278 seconds. Evidence: `/tmp/rift-workbench-xcode-restored.log`. The previous 46 failed tests were environment-related; this targeted rerun does not substitute for the final full release gate on all current changes.

## Full suite after restoring Xcode

`pnpm exec jest --runInBand` completed: **795 suites passed, 1 failed (796 total); 8,119 tests passed, 1 failed, 1 skipped (8,121 total); 24 snapshots passed**, 447.429 seconds. Evidence: `/tmp/rift-full-regression-xcode-restored.log`.

Remaining failure: `lib/workbench/__tests__/git-status-command.test.ts` → `discovers the actual repository root from a nested directory`, received exit 48 instead of 0. The same three Workbench suites had passed in the earlier targeted run. Exit 48 has several causes, including the 3-second Git discovery timeout, so load-related timeout is a hypothesis, not a proven diagnosis. No timeout guard or filesystem boundary was weakened and no failing test was skipped. Native UI tests ran concurrently with this full pass. Source is not yet declared release-gate green.
