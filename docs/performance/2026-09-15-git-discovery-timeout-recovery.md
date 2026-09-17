# Read-only Git discovery timeout recovery

The full suite after Xcode restoration had one failure: nested repository discovery returned 48. A standalone probe of the actual generated command reproduced this as a subprocess timeout: first call 3,767 ms / exit 48, second 1,733 ms / success, remaining calls 139–202 ms / success. See `2026-09-15-git-discovery-cold-probe.json`. This establishes the timeout mechanism; it does not establish which macOS subsystem caused the initial delay.

The discovery helpers used by repository-root discovery and status validation now retry exactly once after a timeout. Each attempt remains limited to three seconds. The old process group is killed and reaped before retrying. Nonzero exits, invalid output, repository escapes and metadata validation failures are not retried or converted into success. The fixed executable, pinned descriptors, sanitized Git environment and output bounds are unchanged. This does not retry writes, user commands, hooks or network operations.

The deterministic regression injects a subprocess timeout into the real generated Python command. One transient timeout must recover to a valid root/status; persistent timeouts must stop after two attempts with exit 48 and no output. Existing filesystem and Git security tests remain enabled.

Initial targeted validation: 51 tests passed across the three Workbench suites (105.31 seconds). Additional status-helper fault injection is included in the final targeted pass. Full release acceptance remains separate.

Final focused suite: 14 tests passed (30.053 seconds), covering both helpers under transient and persistent injected timeouts. TypeScript and targeted ESLint passed. Logs: `/tmp/rift-git-discovery-retry-final.log`, `/tmp/rift-git-retry-types.log`, `/tmp/rift-git-retry-lint.log`.

The first commit hook was not bypassed: it failed after 8,169 passing tests on an unrelated native-console `.js` source import resolution error and a five-second AgentsWorkbench test timeout. The module exists as `protocol.ts`; the Node ESM source correctly names its emitted `.js` output. Jest now maps relative `.js` imports back to source resolution. The two failing suites passed together serially (10 tests, 7.475 seconds). A serial full-run experiment did not eliminate the failures and took 858.797 seconds, so the worker-count change was reverted. The existing two-worker default is preserved.

## Boundary-timeout classification and second full-run result

The second commit hook stopped with 796/800 suites and 8,167 tests passing, eight failing and one skipped (858.797 seconds). It was not bypassed. Failures affected Git operations, root discovery, GitHub checkout preparation and a remote terminal connection wait. Five isolated, instrumented status commands subsequently succeeded in 515–1,612 ms. This does not prove the cause of all full-run failures.

A separate deterministic fault exposed a real classification defect: expiry of the Git child reader during repository validation returned 49 (repository outside authorization), even inside an authorized temporary repository. Three red tests reproduced this for status, diff and mutation preflight. The reader now raises a distinct GitReadTimeout; boundary validation reports the existing read-failure code 48. It still kills and reaps the process before failing, never starts the mutation, and never relaxes path validation or retries a write. Tests assert empty output and unchanged index bytes.

The four previously failing suites plus these regressions passed together: 77 tests, 65.334 seconds. Evidence: `/tmp/rift-git-timeout-red.log` and `/tmp/rift-git-timeout-regression.log`. The full gate must still pass before a commit/release is claimed.
