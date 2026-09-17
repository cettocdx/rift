# Cost audit: owner settlement and cache coverage

Read-only inspection of the current development backend found 53 settlement
intents for the account used by the preview. All 53 recorded margin 1 and an
acknowledged state; 51 used provider cost and two included token estimates.
There were three user records with the owner's email, so inspection selected
the exact user ID in the current worker events instead of assuming the first
email match was the active account. No identity or balance was changed.

For the latest native UI verification run, the worker log contains an admission
debit of 284 points and a final difference of 632 points. Their sum, 916, equals
ceil(0.09158856944444445 _ 10,000 _ 1), matching its recorded cost. This verifies
one observed run, not all historical debit/refund correctness. An acknowledged
settlement journal is not an independent transactional ledger proof.

That run recorded 13,256 input and 13 output tokens, with $0.091559875 model
cost and $0.000028694444444444447 non-model cost. Input payload reduction is a
concrete next investigation; these counts alone do not identify how much came
from instructions, tool schemas, user text or history. No paid model tests were
started for this audit.

## Cache observability correction

The reported cache hit rate previously divided reads by reads + writes. A call
with 100 cached tokens and 10,000 total input tokens therefore reported 100%
when no writes were reported. It now reports 1%. Missing or inconsistent input
coverage remains unknown. The fallback finalizer also subtracted pre-fallback
cache counts after resetModelLeg had already cleared them, allowing negative
metrics; it now uses the retained counters directly in both logging paths.

Four focused assertions failed before correction. The six-suite pricing,
mixed-receipt, attribution, fallback, journal and usage matrix passed 102 tests.
These are measurement corrections, not a reduction in customer charges or a
change to model quality. Production web bundle publication remains pending.

Private read-only evidence: /tmp/rift-cost-readonly.json. No secrets, prompts,
raw user table or credit adjustments are included in this report.

## Provider-boundary input attribution (2026-09-15)

The native short-run evidence above still does not establish which prompt category dominates. Added optional diagnostics at the actual SDK provider boundary, after active-tool selection and message preparation. Durable run telemetry now records serialized character counts separately for system, user, assistant, tool results, and tool schemas, with message/tool counts and a per-run provider request index. No prompt, schema, tool output or credential content is emitted. These values are explicitly not billable tokens and do not change settlement math.

The callback is optional and a reporter failure cannot stop generation or suppress its usage receipt. Seven provider-observer tests passed (`/tmp/rift-prompt-size-tests.log`), TypeScript completed successfully (`/tmp/rift-prompt-size-types.log`). No live savings are claimed: a representative new runtime trace must be collected before deciding which input to reduce. Existing active workers were not restarted for diagnostics.

## Live input profile, 2026-09-15 03:13–03:16 local

Two native Build acceptance calls completed without tools. Tests: `/tmp/rift-input-profile-live.log`, `/tmp/rift-input-profile-second.log`. UI test elapsed from Send action to detected text was 15.92s and 15.95s (includes XCTest interaction/polling overhead; not an instrumented render timestamp). Both had 13,255 input and 11 output tokens.

Second run `run_06ga4qq0gebt2v7tcti8lrkc01` metadata provides the actual provider-boundary profile: system 19,607 serialized characters; user 11,762; tool schemas 37,380 across 28 tools; no prior assistant/tool-result content. Thus historical execution output was not the cause in this fresh-chat sample. Schema text was about 54% of measured serialized content. The user category includes injected reminders, not only typed input. System prompt estimate was 4,143 tokens; do not convert category character shares into billable token shares.

First call model cost was $0.083170 with cache-write usage; second was $0.006971 with 13,252 cache-read tokens. The reduced second cost is provider caching, not evidence that this change reduced prompt volume. No pricing calculation was changed.

Sandbox reuse took 1.954s and 3.646s, but prepareTurnSandbox starts Cloud warmup asynchronously: second run's awaited turnSandbox span was only 9ms. Therefore sandbox duration must not be added to critical-path latency. Second metadata: taskStartLatencyMs 1,286; providerRequestedMs 1,918; firstPrepareFinishedMs 5,137; firstModelTextMs 7,212 relative to worker start. The gap before first prepare completion needs attribution before optimization.

Latest size snapshot is now also stored in Trigger metadata (`providerPromptSize`) so authorized runtime inspection does not depend on an analytics read key. It contains numeric counts only. Both tests passed; no worker was manually restarted. Further work: separate injected reminder sources and profile schema preparation overhead, then reduce redundant inputs while preserving capabilities.

## Initial schema prose reduction

Shortened repeated parameter guidance in run_terminal_cmd, file and generate_video. Video shot composition remains in prompt parameter guidance; reference behavior remains in referenceMode. File ranges remain documented once. Terminal background/interactive defaults, output-file caveat and supported transports remain explicit. No parameter schema types, executors, permissions or limits changed.

Validation: 55 terminal/video tests (`/tmp/rift-tool-description-tests.log`) and 9 file-read tests (`/tmp/rift-file-description-tests.log`) passed; TypeScript succeeded (`/tmp/rift-tool-description-types.log`). This reduces supplied prose, but no new provider-token or wall-clock comparison was run for this edit. It does not resolve the broader schema-loading/startup issue by itself.

Read-only enabled-skill inspection also located a 6,691-character managed roster, including 762 characters of serialized configuration. This was not removed: the role contracts and server configuration semantics need separate review before projecting a smaller prompt.

## Measured schema reduction and startup separation

Run `run_06ga4t9fj18ih4f1io6ci4i701` completed with the same fresh native acceptance prompt/model. Schema serialized characters fell from 37,380 to 36,576; provider input tokens fell from 13,255 to 13,079 (176 tokens, 1.33%). All 28 tools remained available. Cache-write cost $0.082070 versus the earlier cache-write $0.083170 is consistent with the smaller request, but a single pair does not establish general savings.

Added numerical setup-stage timing: capabilities ready 58ms, model ready 58ms, messages ready 59ms, SDK entered 59ms, first prepare entered 72ms from createAgentStream entry. First prepare lasted 117ms. Worker first visible model text was 5,507ms after worker entry; the UI test observed text after 10.60s including test-driver overhead. Previous approximately 3s pre-prepare gap did not recur. Do not claim schema preparation was that gap's cause or that latency is now fixed.

Live test `/tmp/rift-preparation-profile-live.log` passed. Shared agent-loop suite passed 28 tests (`/tmp/rift-preparation-profile-tests.log`); TypeScript succeeded (`/tmp/rift-preparation-profile-types.log`). Instrumentation is optional, numeric-only and non-fatal. Remaining latency budget includes admission/worker start, model response, transport and actual native presentation; controlled repeated samples and native timestamps remain needed.
