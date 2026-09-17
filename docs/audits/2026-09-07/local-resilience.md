# Local execution and reconnect audit — 2026-09-07

Scope: source review and deterministic regression tests in the reference-ui worktree, followed by the isolated Cloud protocol smoke documented below. No model calls, service restarts, deployments, or native UI automation were performed in this lane. The root lane separately owns the authenticated Local runner smoke.

## What actually runs locally

There are two distinct execution paths; they should not be presented as interchangeable.

1. **Connected CLI runner:** the execution target is a specific owner-checked connection ID. Agent command and PTY tools send messages through Centrifugo to `packages/local/src/index.ts`; that process launches commands on the connected computer. The model and agent orchestration still require network services. This is local tool execution, not an offline model or a filesystem sandbox.
2. **Native selected-file access:** the picker obtains an opaque native grant, the request carries `workingFile`, and `desktop_workspace_read/write` relay to `read_workspace_file/write_workspace_file`. A file grant edits the original file, requires its latest SHA-256 version for a write, cannot become a terminal or parent-folder grant, and remains restricted to the requesting chat's selected file. No copy-to-cloud fallback is used for the original file.

The production desktop relay currently advertises `commands:false` and `pty:false` in `convex/localSandbox.ts`. Existing native interactive shell profiles are a separate, explicitly granted UI terminal feature. This audit did not broaden those capabilities or enable the debug command server in production.

At discovery, `HybridSandboxManager` ignored every non-E2B preference, and chat restoration could replace a missing runner with Cloud. The manager/worker and chat fixes are owned by the other lanes. This lane removed additional silent Cloud coercions in `useSandboxPreference`: an unavailable Local choice remains the selected target and must fail explicitly rather than execute elsewhere.

## Confirmed defects and fixes

| Defect and reproduction | Source boundary | Result |
| --- | --- | --- |
| A second subscription acknowledgement published the same local write again. | `lib/desktop/local-access-relay.ts` | Once-dispatch guard applies before publish, including an unacknowledged publish. Reconnect does not automatically repeat a native side effect. |
| Abort during desktop lookup or token minting still allowed a later write to be dispatched. | Same relay | Abort is rechecked after both awaits and immediately around listener registration / publication. |
| A write could complete natively, then a failed result publication entered the execution-error catch and emitted `ok:false`. | `app/services/desktop-sandbox-bridge.ts` | Execution and acknowledgement are separate. Write/open requests use pending/completed request-ID deduplication. A failed acknowledgement remains buffered and can be resent on resubscription without rerunning the operation. |
| An old native operation could publish its result into a replacement connection after stop/start. | Same bridge | Operation completion and publication are fenced by lifecycle version and subscription identity. The old result never goes to the new connection. |
| After a presence-swept session or failed startup, grants remained present but the relay could remain unavailable until another picker interaction. Grant changes could also replace a healthy reconnecting socket. | `app/hooks/useSandboxPreference.ts` | Online, focus, visibility and a visible-only 30-second check can recover terminated sessions. A still-owned reconnecting socket is retained. A session intentionally replaced by another desktop or rejected for authentication is not reclaimed. Temporary native grant-list errors no longer imply revocation. |
| A CLI command was republished both during an in-flight publish and after a successful publish when the subscription recovered. | `lib/ai/tools/utils/centrifugo-sandbox.ts` | Pending/published guards prevent the second command dispatch. The CLI does not need to guess whether it should rerun it. |
| A recovered PTY subscription sent `pty_create` again; the runner could spawn another process under the same live session ID. | `centrifugo-pty-adapter.ts`, `packages/local/src/process-runner.ts` | One create per adapter; duplicate live IDs are rejected before a second spawn. |
| PTY tokens were fixed at 600 seconds without a refresh callback. Terminal disconnect could leave `exited` unresolved. | `centrifugo-pty-adapter.ts` | Long-running PTYs refresh via the sandbox token issuer. Terminal disconnect/unsubscribe rejects pending startup or resolves an already-ready handle with unknown exit status (`null`), never invented success. |
| The one-hour CLI idle timer checked only when commands were last received. It could terminate a silent active command or an open PTY, and finishing long work did not restart the idle hour. | `packages/local/src/idle-tracker.ts`, `index.ts`, `process-runner.ts` | Active command spans and open PTYs prevent idle shutdown. Completion resets the idle clock. Finish callbacks are idempotent. An open interactive shell intentionally keeps its runner alive until the shell closes or the user quits. |
| An outer terminal retry created a fresh command ID after an unacknowledged local dispatch, repeating host side effects despite the per-subscription once-dispatch guard. | `lib/ai/tools/run-terminal-cmd.ts` | Local foreground and background commands dispatch once. A rejected transport result returns `exitCode:null`, `outcome:unknown`, and instructions to inspect current state rather than repeat the command. The existing cloud retry policy is separate. |
| A failed background start with exit code -1, 2, or 130 was displayed as a started background process. | Same terminal tool | Nonzero background results retain their exit code and error; no success message or process-tracker entry is produced. |

An unacknowledged dispatched write/open operation now has `outcome_unknown`, not a definite rejection. Tool output tells the agent that the change may already have completed and requires checking current state before another change. Native path details are not propagated in this explanation.

## Limits retained deliberately

- This is not a claim of durable exactly-once execution. Desktop deduplication is scoped to the live bridge, stores up to 256 recent mutation outcomes, and retains completed entries for five minutes. A new desktop registration has a new connection ID; old results are not transferred into it.
- A process/app restart loses the in-memory desktop acknowledgement cache and native file grants. The user must reselect revoked/missing access. No fallback target is selected automatically.
- An abort cannot undo a native file write that has already started. A missing acknowledgement is explicitly indeterminate; it does not authorize a replay.
- Brief reconnects can preserve the existing CLI process. There is no durable stdout replay log here, so a missing stream segment or terminal transport loss cannot be reported as a verified successful run. A worker task that has already timed out does not silently resume a new side effect.
- The CLI's detached background processes are not PTY sessions and are not tracked to their eventual exit by the existing runner. The new idle policy counts the foreground command that starts them; it does not claim lifecycle control over an independently detached process.
- Local runner commands execute on the connected host without OS sandbox isolation. The native file-grant path remains much narrower. User permission mode and existing tool approval gates are unchanged.

## Verification

All nine focused suites passed: **112 tests**, zero failures.

- `lib/desktop/__tests__/local-access-relay.test.ts`
- `app/services/__tests__/desktop-sandbox-bridge.test.ts`
- `app/hooks/__tests__/useSandboxPreference.test.tsx`
- `lib/ai/tools/__tests__/desktop-workspace.working-file.test.ts`
- `lib/ai/tools/utils/__tests__/centrifugo-sandbox.test.ts`
- `app/services/__tests__/desktop-local-access.test.ts`
- `lib/ai/tools/utils/__tests__/centrifugo-pty-adapter.test.ts`
- `packages/local/src/__tests__/process-runner.test.ts`
- `packages/local/src/__tests__/idle-tracker.test.ts`

Final suite log: `/tmp/rift-local-resilience-final.log`.
Red reproductions: `/tmp/rift-local-relay-before.log` (4 failures), `/tmp/rift-local-bridge-before.log` (3), `/tmp/rift-local-recovery-before.log` (4), `/tmp/rift-local-command-before.log` (2), `/tmp/rift-local-outcome-before.log` (1), `/tmp/rift-local-idle-before.log` (4), `/tmp/rift-local-process-before.log` (1), `/tmp/rift-local-pty-before.log` (5). These tests exercise event/async behavior; no real command was launched.

CLI typecheck: `/tmp/rift-local-cli-typecheck.log`. Focused lint: `/tmp/rift-local-resilience-lint.log`. The root lane owns authenticated end-to-end Local execution and the native application rebuild/launch.

The follow-up terminal verification passed **61 tests across five suites**: `run-terminal-cmd`, `interact-terminal-session`, `sandbox-capabilities`, `centrifugo-sandbox`, and `centrifugo-pty-adapter`. Log: `/tmp/rift-local-terminal-final.log`; focused lint: `/tmp/rift-local-terminal-lint.log` (exit 0). The retry regressions failed first with two dispatches instead of one (`/tmp/rift-local-terminal-retry-before.log`); the background failure regressions first lost their real exit codes (`/tmp/rift-local-terminal-background-before.log`).

## Packaged CLI artifact

The completed CLI sources were built and packed as version **0.8.4**, then the real archive replaced `public/downloads/rift-cli.tgz` atomically. `package.json` names the executable `rift-cli` at `dist/index.js`; the packed entry has mode 0755 and its shebang. All four compiled JavaScript files were compared byte-for-byte with the build output. The archive contains only package metadata, README, LICENSE, and compiled distribution files.

- Size: 23,229 bytes.
- SHA-256: `541d7b63dd911020f275af4028bc95f2729fa06321172d36f704355631474e45`.
- Build/pack logs: `/tmp/rift-cli-0.8.4-build.log`, `/tmp/rift-cli-0.8.4-pack.log`.
- Artifact verification: `/tmp/rift-cli-0.8.4-verification.json`.

The terminal retry correction is server tool code and does not change this CLI artifact. No package was published or installed by this lane.

## Real Cloud protocol smoke

At `2026-09-07T20:15:46Z`, `tmp/resilience-cloud-smoke.ts` completed with exit 0 against the preview deployment and designated smoke chat `c102a131-9296-472c-9084-378f4596d0d3`. It used that owner's HMAC-derived per-chat fixture namespace, never the user's default/project sandbox. No existing fixture was present, so the latest `HybridSandboxManager` selected `e2b` and created only this isolated fixture.

The real sandbox command reported Linux, wrote a unique file below `/tmp/rift-cloud-resilience-smoke-eeec789d-f002-4f58-98d0-fa6ed90dbba1`, and the file was read back through the remote filesystem API. The corresponding path was absent on the local Darwin host before and after execution. The script deleted only its own remote file/directory and terminated its newly created sandbox in `finally`.

Evidence: `/tmp/rift-cloud-resilience-smoke-evidence.json`; log: `/tmp/rift-cloud-resilience-smoke.log`. No model run, chat persistence change, project replacement, local service restart, or deployment was involved. This proves real Cloud command/file routing through the current manager; it does not test a paid model's behavior, UI switching, or long-duration provider outages. The TypeScript runner was invoked directly from the existing npx cache, without installing a package.
