# Remote command descendant supervision

Foreground E2B commands now run under a Linux child subreaper. The SDK PID identifies the supervisor; the user's command and its descendants belong to that supervisor. Detached children are adopted rather than disappearing when the command's original parent exits.

Stop uses a verified PIDFD signal to the supervisor, not SDK SIGKILL against its PID. The supervisor repeatedly freezes/kills its child tree and reaps until the kernel reports ECHILD. Only then does it persist `descendantsReaped: true` and exit. The backend exit receipt requires that final proof as well as the exact SDK exit receipt. PID reuse is checked after opening the PIDFD. A process disappearing between identity check and signal is handled without crashing the supervisor.

The command's execution budget is enforced remotely, independently of the worker or SDK transport. Budget expiration exits 124 after child cleanup. User Stop exits 130. Explicit background previews and interactive PTYs are still separate lifecycles. Foreground shell backgrounding does not keep a child alive after its command completes; the tool already instructs agents to use `is_background` for persistent jobs.

## Live evidence

- A separate Node producer launched a remote command and then exited. Its detached child and main command remained observable (2 processes). Independent Stop subsequently reduced matching processes to 0, with final state exited and descendantsReaped=true.
- A 30-short-lived-child run completed with exit 0 and unchanged expected stdout. A subsequent launch after the remote seal was denied with exit 125.
- A 10-second command given a 150ms remote budget exited 124 with descendant cleanup proof; total API-observed time was 1044ms.
- Actual RIFT Stop run `run_06g9qk2kc0jg59futbchmcqs01` completed with Stop HTTP 200, canceled=true, and no remaining matching command. Durable resource PID 2224 was recorded exited with supervised-v1 identity.
- Focused helper/terminal checks: 57 passed.
- Evidence: `/tmp/rift-supervisor-orphan-proof.json`, `/tmp/rift-supervisor-race-proof.json`, `/tmp/rift-supervisor-budget-proof.json`, `/tmp/rift-supervisor-durable-proof.json`.

## Remaining work

The producer-exit probe is a real remote-process survival/cleanup test, not a forced termination of a Trigger worker running a full agent task. Independent periodic backend reconciliation, recovery of reserved-but-unacknowledged launches, PTY coverage, task resumption and billing reconciliation remain incomplete. The system must not clear an entire run's cleanup fence merely because its foreground resources are closed; untracked PTY or integration cleanup may still be pending. No production readiness or absolute outage guarantee is claimed.
