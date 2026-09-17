# Runtime continuity and measured startup latency

## One checkout for the running preview

The production-built web preview already used `/Users/cetto/RIFT-Release`, but
the local Trigger development worker and managed Local runner still launched from
`/Users/cetto/.codex/worktrees/rift/reference-ui`. Independent comparison found
no meaningful worker/runner behavioral drift: all six Trigger task files, task
configuration, dependency maps, lockfile, patches, environment values and all
seven Local runtime modules matched. No secret values were emitted. A stale
launch path was therefore **not** established as the cause of the latency.

Both launch paths now use the release checkout. The worker is supervised by
`app.riftsys.ui-preview-worker`, with its existing development command/environment
and log files under `~/.local/share/rift-ui-preview/worker`. The old worker was
stopped only after the authenticated Trigger API showed no active or queued
runs; an earlier attempt was deferred for a live scheduled dispatcher. Its
replacement is ready with the same content version `20260910.28` and verified
release cwd. This remains a **development worker**, not a production deployment.

The Local runner was migrated after a ten-second relay observation and process
inspection found no active user command/PTY. All seven release `dist` modules
matched an isolated fresh compilation. Normal token refresh and command readiness
confirmed the same owner and connection identity after restart. Default cwd/root
for newly launched local work now follows the release checkout. The prior plist
is retained at `/tmp/rift-local-runner-migration-6Jh0tg/original.plist` for an idle
rollback. Evidence: `/tmp/rift-local-runner-migration-results.json`.

## Settings preserves the terminal layout

The global route teardown explicitly closed the terminal on entry to Settings;
the presentation hook then persisted that close. The hook now treats Settings as
a temporary suspension, retaining the account-owned last application pathname,
visibility and terminal/console selection. Returning to the same route restores
the panel, including after a Settings reload. Explicitly hidden panels stay
hidden, account changes do not leak state, and another chat closes the panel.

Direct new-chat URL promotion derives visibility synchronously, avoiding a
committed hidden frame. Regression observations assert every promotion commit
stays open and terminal content mounts once. Seven focused suites passed 80 tests;
TypeScript, scoped lint and independent review passed.

On the installed `/Applications/RIFT UI Preview.app`, Terminal 3 remained connected
after web restart/reload, Settings navigation, Cmd+R inside Settings and Back to
app. The panel returned without clicking Show terminal. Hiding the panel before
another Settings visit left it hidden on return. No PTY lifecycle code changed.

During the long command, the sidebar incorrectly said `thinking` while the
conversation correctly showed `Running a command`. The worker's coarse phase
can be seeded once or updated by completed-call telemetry, so it is not evidence
of current activity. The sidebar now renders authoritative lifecycle status
(Running, Waiting for approval, Stopping) and retains the user goal in its tooltip.
No command activity is inferred. Six red regressions captured stale phases; 33
tests across two suites, TypeScript and scoped lint passed after the UI-only fix.

## Real isolated Local fault injection

The harness now uses the ordinary `localSandbox.connect` response for validated
owner identity, relay endpoint and relay credentials. It no longer accepts a
guessed user ID or signs a privileged observer token. Source is compiled into a
temporary directory, with isolated cwd, HOME, state and proxy. Existing managed
services and user commands are untouched.

Independent review tightened the test: real newline execution counters, exact
marker order, failed disconnect acknowledgements and bounded launcher waits are
checked. Four regression tests include two real shell counter writes producing a
count of two. The corrected full harness rerun passed:

- A 15-second relay outage: all 60 markers in order, none missing/duplicated,
  one execution and exit 0.
- SIGTERM launcher restart: unchanged connection identity, original command
  completed once with exit 0.
- A new command after restart: expected output and exit 0.
- Cancellation after restart: exit 130 without executing the forbidden tail.

Both counter files contain exactly one `start` line. Cleanup verified no remaining
isolated processes, an inactive QA connection, closed proxy and stopped launcher.
Current evidence: `/tmp/rift-local-fault-results.json`, directory
`/tmp/rift-local-fault-Xev31r`. These bounded scenarios do not prove every possible
outage duration, process failure or platform.

## Twenty real persisted starts

Sequential authenticated `merhaba` requests used `build-codex` (GPT-5.6 Sol),
medium effort, fresh persisted chats, production-built web on port 3020 and the
local development worker. No build ran during this measured batch. All 20 runs
completed with final responses and zero duplicate stream events.

| Measurement                     |   Median | Nearest-rank p95 |
| ------------------------------- | -------: | ---------------: |
| First response text             | 6,001 ms |         6,986 ms |
| Route start to dispatch request | 1,066 ms |         1,766 ms |
| Dispatch request to task start  | 1,181 ms |         1,315 ms |
| Task start to provider request  | 1,119 ms |         2,682 ms |
| Provider request to first text  | 1,786 ms |         2,699 ms |
| First worker text to observer   |   212 ms |           309 ms |

Maximum first text was 7,663 ms. Per-stage quantiles are not additive. Dispatch to
task start includes network/dequeue/local process/module setup; it is not a pure
spawn timer or an established production cost. The benchmark now records the
existing worker timestamps separately and prints non-secret run/chat handles at
admission so an observer timeout cannot hide a still-running task.

`harness-quality.cjs` correctly fails the median target of 4,000 ms, while the
8,000 ms p95 target passes. These greeting tests do not establish production load,
complex-task speed, provider diversity or Cursor/Claude parity. Evidence:
`/tmp/rift-startup-clean-20-20260911.json`.

The strongest identified next code change is claim-guarded atomic initial
chat/message persistence, retaining final pre-dispatch checks and all worker
ownership/entitlement/billing checks. Its expected RTT savings remain unmeasured;
no authorization check was removed to improve these results.

## Ten-minute agent command exposed a remaining deadline defect

Run `run_06g8ruk2b6qa557mvfgv0pfv01` started one shell loop printing markers
0 through 59 with ten-second intervals. The observer intentionally detached after
the tool started. During the task, the production web service was restarted,
the native renderer reloaded, Settings visited/reloaded, another page opened, and
the native window minimized/restored. On return the command was still progressing;
the native transcript showed markers 0–43 at roughly seven minutes and the new
sidebar `Running` label at nine and a half minutes. The existing native shell
also remained PID 98083 under app PID 86810 throughout the UI checks.

The remote run completed while the observer was detached, and replay delivered
the final response with zero duplicate event IDs. **The command acceptance test
failed**, correctly returning a nonzero probe exit: the tool's 600-second timeout
returned `exitCode: null`, although marker 59 had arrived. The agent did not rerun
the command or claim success. The request had explicitly asked for at least 630
seconds, but `run-terminal-cmd.ts` clamps observation to 600 and the sandbox command
options separately impose a 600,000 ms process deadline. Reliable connection and
final message delivery therefore did not establish successful command completion.

Evidence: `/tmp/rift-agent-soak-clean-20260911.json` and its `.log` counterpart.
This failed boundary case is retained as evidence for the next runtime fix; it
must not be counted as a passed ten-minute command acceptance test.

## Deadline and uncertain-execution repair

Inspection of installed E2B 2.27.0 found a second defect: `commands.run` starts a
new process before waiting for its result, while RIFT retried that entire call up
to six times on transport/timeout errors. A failed observation can follow real
side effects; repeating the call can therefore repeat the user's command.

The repair submits once on either backend. Cloud execution retains the public
E2B command handle and waits on that same handle; cancellation targets that
handle, including a start acknowledgement arriving after cancellation. An
unconfirmed result retains available output/PID and an explicit unknown outcome.
This is at-most-once submission by this tool, not exactly-once execution across
arbitrary provider failures.

Explicit command budgets now support up to 30 minutes. The local execution
budget is distinct from bounded admission and exit delivery. E2B's SDK stream
deadline receives exit-delivery allowance; it does **not** establish that the
cloud process was killed. Omitted timeouts retain the existing 60-second
observation and ten-minute backend default. Interactive PTY observation keeps
its separate behavior.

Seventy-five focused tests across four suites passed, including red-first
regressions for the 600-second clamp, late cloud failure resubmission, exact
handle cancellation, late acknowledgement and admission consuming the execution
window. Independent code review found no remaining blocker in this bounded fix.

The live acceptance verifier now checks the actual requested timed shell loop,
one foreground noninteractive `run_terminal_cmd` submission/result, ordered
markers, a tool duration of at least ten minutes, and numeric exit zero without
an unknown outcome. Model success text alone cannot satisfy acceptance. Eight
isolated verifier tests passed. The fresh live run
`run_06g8s2ppi7rac7itb7llp0ts01` on worker `20260911.5` **passed**:

- One exact requested foreground command and one matching result.
- 60 ordered markers, zero duplicate stream events, confirmed exit 0.
- Tool execution duration 601,413 ms; end-to-end duration 622,847 ms.
- Completed while the probe observer was detached, with final response replayed.
- Native window minimized/restored, another conversation opened and renderer
  reloaded during execution; the run continued independently.

Evidence: `/tmp/rift-agent-soak-fixed-20260911.json` and its `.log` counterpart.
The first-text time in this recovery probe includes intentional observer
detachment and must not be used as a startup latency measurement. This closes
the reproduced ten-minute boundary case, not every possible long-task failure.

## Live activity follows the command, not raw output

The same native test exposed `Reviewing command results` while the tool row was
still running. `data-terminal` chunks contain output and a tool-call ID but no
lifecycle state; the presentation helper treated missing state as completion.
It now resolves each chunk to its matching tool and uses that tool's real state
and command input. Orphan output is ignored. A single indexed pass avoids
repeated scans for long transcripts. Eleven red-first regressions cover active
output, completed/error replay, concurrent tools, classification and orphan
chunks; the 56-test activity/progress check passed after the repair.

Before this final presentation repair, the complete Jest suite passed 620 suites,
5,521 tests and 24 snapshots, with one existing skipped test. Seventeen separate
Node acceptance-helper tests passed. The normal commit hook reruns the complete
suite after final formatting, along with typecheck and artifact freshness.
