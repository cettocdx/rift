# Vercel AI SDK runtime alignment

RIFT already used `ai` 6.0.191, `@ai-sdk/react` 3.0.193 and an AI SDK-compatible OpenRouter provider. No provider account migration, model selection changes or dependency upgrade was needed.

| Runtime | SDK usage |
| --- | --- |
| Chat and durable Build | Shared `createAgentStream` uses AI SDK `streamText`, tool execution, prepareStep, stop conditions, streamed UI messages and persisted checkpoints. |
| React conversation | AI SDK Chat/DefaultChatTransport, retained across navigation. |
| CLI model step | Now encapsulated as `createConsoleModelAgent` using AI SDK `ToolLoopAgent`. Exactly one step; tool schemas have no server execute handlers. |
| CLI execution | Independent local file/command loop, explicit approvals and persisted history. The authenticated RIFT endpoint supplies model steps. |
| Subagents | Existing SDK `generateText` tool loops and budget/approval controls. |

## Corrections

- Canceling the CLI response body now aborts the upstream SDK generation through a combined request/reader cancellation signal.
- SDK timeouts bound a model call to 270 seconds total and 120 seconds without stream activity, leaving time inside the 300-second route deadline for reconciliation.
- Request cancellation and SDK abort chunks cannot be reported as successful partial completions.
- A CLI parse/protocol error cancels its stream reader rather than leaving generation running after releasing the reader lock.
- Credit settlement remains before delivery of executable tool-call messages; usage is reconciled once and output-free failures refund their reservation.

The shared Build runner retains `streamText` because it already uses the SDK natively and owns onChunk/onAbort/onError hooks plus durable checkpoint boundaries. The installed ToolLoopAgent API does not expose all those lifecycle hooks; replacing that runner mechanically would discard behavior. OpenRouter is a compatible provider, not a competing agent harness. Separate moderation and MCP integrations are not replaced by a model-generation SDK.

## Verification

- 59 SDK/route/Build-loop/checkpoint/model-contract tests passed.
- 40 console tests passed, including malformed-live-stream cancellation with no automatic retry or tool execution.
- Root TypeScript and console build passed.
- Real local CLI client against localhost:3020, GPT-5.6 Sol, read-only response smoke: configuration 488 ms; first text 3.46 s; complete 3.71 s; expected answer, ready state, no errors or approvals. A single short request does not establish a general speedup.
- CLI 0.2.1 installed locally. Restart a running CLI to load new code. Changes are in the UI preview checkout, not a claim of public deployment.

References: [Vercel AI SDK](https://vercel.com/ai-sdk), bundled `node_modules/ai/docs/03-agents/02-building-agents.mdx`, `node_modules/ai/src/agent/tool-loop-agent-settings.ts`, and `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`.
