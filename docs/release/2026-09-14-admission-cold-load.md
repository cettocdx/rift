# Admission cold-load cleanup

The Build admission route imported `chat-stream-helpers` solely for the no-op
legacy free-tier gate. That module imports model providers, summarization,
tokenizers and system prompts. The no-op compatibility function now lives in a
type-only leaf module and is re-exported for existing callers. Real account,
billing and execution guards remain unchanged.

The hybrid sandbox manager (including E2B runtime) is loaded only in the local
presence or local-attachment branches that use it. Ordinary cloud text admission
no longer directly imports it. This defers loading, not sandbox authorization.

58 focused startup/contracts tests passed, TypeScript and scoped ESLint passed.
Do not infer end-to-end latency reduction until live measurement is recorded.

Previous 20260914.13 samples separate the delays: explanation first text 34075ms,
dispatch-to-handler 21126ms, handler-to-model-request 4572ms, first model text at
10057ms relative to handler start. Greeting first text 15002ms included 7741ms
between model request and first model text. These are distinct worker and provider
contributors, so a universal four-second guarantee is not established by imports.

## Published and measured

Preview 3020 was published from `.next-ui-release-1789377150180-pre-effects`.
Live worker version: `20260914.14`. Evidence:
`/tmp/rift-startup-lazy-20260914.json` (three persisted mixed scenarios).

| Scenario    | First text | Admission | Dispatch to handler | Handler to model request |
| ----------- | ---------: | --------: | ------------------: | -----------------------: |
| Greeting    |   11145 ms |   5050 ms |             2786 ms |                  1729 ms |
| Explanation |   21439 ms |   2296 ms |             4066 ms |                  2533 ms |
| Terminal    |   39968 ms |   2085 ms |            17969 ms |                  3540 ms |

All three completed and passed scenario checks; zero duplicate observed events.
Terminal first executable tool input arrived at 33358 ms; first text follows
its command result, so it is not interchangeable with provider TTFT.
Explanation's model-request-to-first-chunk interval was 13245 ms.
These single samples per scenario do not establish an SLO or causal improvement.
The four-second first-response target is NOT met.

Read-only retrieval of the same runs' existing startup metadata (no additional
model calls) revealed module evaluation windows of 221, 187 and 4869 ms,
respectively. Terminal process age at handler entry was 12127 ms. Module
measurement excludes parsing/loading before the leaf probe and must not be
labelled total cold start. These fields currently exist in run metadata but are
omitted by the benchmark's startup evidence allowlist.

Installed Trigger development supervisor defaults `processKeepAlive` to false;
RIFT's current config does not enable it. The development process pool therefore
creates a new process for each execution. No SDK patch or process-reuse setting
was applied: sharing a process needs isolation verification of module-global
clients, cleanup state and credentials before deployment. The existing shared
worker was not restarted. Host CPU contention was observed, not controlled.

Remaining dominant work: isolate task-process loading/scheduling from host load,
validate a persistent/production execution path with correct per-run isolation,
and measure the selected provider's first-chunk latency independently. Do not
lower the user's reasoning setting or substitute models to claim success.
