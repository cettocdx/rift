# Explicit tool-free text requests

Fresh Build requests beginning with an explicit English/Turkish no-tools
instruction now use a compact text prompt, omit tool schemas and skill
injection, and avoid cloud sandbox prewarming and GitHub/MCP discovery.
The chosen model and reasoning settings remain unchanged. Moderation still
receives the actual greeting flag, never the broader tool-free classification.
Local access checks, billing, execution ownership and receipt persistence remain.

The classifier excludes attachments, history, project/working-file/goal/profile
context and regeneration/continuation. It does not infer capabilities from
message length. Requests without the explicit leading instruction retain the
full Build workflow. Thus this is not a general reduction for all short chats.

## Verification

88 tests passed in four suites: classification, existing greetings, system
prompts and runner usage. Scoped ESLint and production build (including
TypeScript) passed. Previously verified cache-accounting corrections are also
included in the new web bundle.

One live persisted explanation request using build-codex / medium completed,
confirmed the final sentinel and observed zero tool attempts. Compared with the
previous same-scenario baseline:

- System prompt estimate: 4,143 -> 753 tokens (81.8% reduction).
- Provider-reported input: 13,313 -> 3,298 tokens (75.2% reduction).
- New output: 68 tokens; provider model cost $0.024913625.
- First text: 9,756 ms. Under-four-second latency remains unachieved.

The runs were not a controlled price/latency experiment; caching, provider
routing, output and machine load can differ. The scenario validates completion
and no-tools behavior, not semantic answer quality. No broad savings or
performance SLO is claimed.

Live evidence: /tmp/rift-tool-free-cost-live.json and the matching worker usage
event for run_06g9vjbllr2hdf72qp21f0ki01.

Published .next-ui-release-1789387280352-pre-effects on localhost:3020 after
fresh idle/remote-cleanup proof. HTTP 200 confirmed after publication. Worker
version 20260914.26 contained the new path. No native binary replacement was
required; the existing preview uses that local web origin.
