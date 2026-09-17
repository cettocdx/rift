# Build tool context reduction

## Finding

A persisted, no-tool explanation on worker `20260911.41` used 19,030
provider-reported input tokens. Its recorded system prompt estimate was 4,170.
Those counters cover different inputs: enabled skill reminders are appended to
messages after system-prompt counting, and function schemas add further context.
The difference must not be labeled entirely as tool-schema tokens.

An offline measurement of the actual `createTools` Build factory, with memory,
desktop, web, URL retrieval and media available and no connected MCP schemas,
estimated 10,037 GPT tokens for 27 serialized tool definitions. Sandbox
constructors were stubbed; no tool or external service was executed. The exact
provider serialization and tokenizer can differ from this estimate.

The same QA owner's enabled-skill metadata showed large application packs
(including controls, design and managed agent roster) that can be included in
short explanations. This batch does not disable or rewrite those preferences.
Task-relevant skill loading remains a separate work item.

## Change

Shortened repeated instructions in terminal, persistent terminal session, file,
and four note tools. Build no longer receives terminal pentest examples; Hack
Workbench retains scoped assessment and timeout guidance. Replaced the false
promise of execution without approval with the actual runtime approval and
guardrail rules.

Tool names, availability, input schemas and execution handlers are unchanged.
Preserved timeout/uncertain-result guidance, persistent-session output and
scrollback retrieval, verbatim input, atomic file edits, model/Plan restrictions,
account-wide note persistence, and prohibition on saving task authorizations as
permanent preferences. Existing approval and execution-journal wrappers remain.

The 27-definition estimate fell from **10,037 to 7,800 tokens** (22.3%). The
seven edited descriptions alone fell from **3,151 to 1,017 tokens** (67.7%).
These are prompt-size estimates, not a promise of equal dollar or latency savings.

## Evidence and limits

- Meaningful red: description budget was exceeded and terminal falsely promised
  no approval. Two preservation tests already passed before the fix.
- New four-case factory regression checks context budget, Build/WorkBench scope,
  approval language, output and note guidance.
- Independent TypeScript AST comparison against the preceding commit found all
  fourteen `inputSchema` and `execute` properties unchanged.
- Existing terminal, session, Plan-boundary and profile-policy behavior tests
  remain the execution checks; a description test alone cannot establish them.

Local evidence: `/tmp/rift-tool-context-red.log`,
`/tmp/rift-tool-schema-before.json`, `/tmp/rift-tool-schema-after.json`,
`/tmp/rift-description-runtime-contracts.json`, and
`/tmp/rift-explanation-skill-audit.json` (metadata/counts, no instructions or
credentials). Live and release results are tracked in the external verified
progress report after deployment. This change does not establish the startup
SLO, comparative desktop quality, or complete receipt accounting.
