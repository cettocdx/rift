# Model refresh and startup latency — 2026-09-08

## Model catalog

Source: https://openrouter.ai/api/v1/models and each selected model's `/endpoints` response, checked on 2026-09-08.

| Picker | OpenRouter ID | Context | Efforts | Default |
| --- | --- | ---: | --- | --- |
| GPT-6 Astra | openai/gpt-6-astra | 1,050,000 | low, medium, high, xhigh, max | medium |
| Claude Fable 5.1 | anthropic/claude-fable-5.1 | 1,000,000 | low, medium, high, xhigh, max | high |
| Gemini 3.8 Flash | google/gemini-3.8-flash | 1,048,576 | low, medium, high | medium |

All three advertise mandatory reasoning, tool calling, text, image and file input. Astra endpoints advertise a 922,000-token prompt ceiling; the app and console model route respect that separately from the total window. The CLI text protocol remains text-only.

Gemini 3.8 Flash was the newest general-purpose Gemini in the catalog. The catalog's Artificial Analysis intelligence/coding/agentic indices were 41.2/76.3/41.1, compared with 30.4/68.8/10.3 for the latest listed Pro, Gemini 3.1 Pro Preview. This is the selection rationale, not a universal benchmark claim.

Removed Luna, Sol Pro and Sonnet from the shared visible catalog. Stored picker selections migrate to Sol, Astra and Fable respectively. Retained legacy provider registrations for already-started work. New Sol fallback requests no longer route through Luna. Sol remains the unchanged default model.

The app, local CLI configuration endpoint and provider allowlist derive from BUILD_MODELS. Added explicit baseline pricing for all three new routes; provider-reported usage cost remains the billing authority, including variable long-context rates.

Live authenticated `/api/console/model` smoke checks returned HTTP 200 and complete events for all three routes, with no error event. Total request durations: Astra 6.1s, Fable 6.1s, Gemini 2.6s. These are short connectivity checks, not benchmarks. Native RIFT UI Preview's menu and authenticated `/api/console/config` both showed the new list and no retired choices.

## Greeting startup investigation

Two original Sol greetings recorded 7.2–7.4 seconds of setup before the UI stream was registered. Added per-stage numeric timings and model-request/first-model-chunk timings to Trigger metadata, without prompts, tool payloads or credentials.

A fresh persisted `merhaba` request reproduced the issue:

| Measurement | Before | After |
| --- | ---: | ---: |
| Message processing, including serial moderation | 3,892ms | <1ms, moderation awaited separately |
| Moderation | included above | 2,678ms, overlaps checkpoint/billing |
| MCP discovery | 6,008ms | 1ms, no external connections for standalone greeting |
| Worker start → provider request | 13,793ms | 4,253ms |
| Worker start → first model chunk | 17,139ms | 6,952ms |
| Request → observed completed Trigger run | 24,362ms | 15,658ms |

Same Sol model and medium effort. End-to-end completion measurements include run-status polling and final persistence; first model chunk can be reasoning, not necessarily visible answer text. The desktop showed `Worked for 8s` on the improved run; its original user greeting showed 19s. This is one controlled pair, not a p95 or production guarantee.

Changes:
- Enabled-skill loading overlaps customization/history loading after owner-bound worker admission.
- Tag registration is one batched request.
- Moderation still completes before model generation or external connector setup, but runs concurrently with checkpoint and billing admission.
- Preflight token estimation receives the actual app/image purpose rather than counting the security prompt for every surface.
- A narrowly recognized first, text-only greeting omits MCP/GitHub discovery and exposes no executable tools for that turn. The selected model generates the answer normally. Attachments, project/profile/goal context, continuation, regeneration and real instructions retain the normal tool path.
- Normal MCP/GitHub lookups run concurrently, with the existing connection teardown retained.

Remaining latency includes durable queue startup, authentication/storage/network round trips, moderation and provider response time. This does not remove all latency or claim every model responds instantly. Real Build tasks still keep durability, permission gates, model effort and available tools.

Validation: 248 tests across 15 targeted suites passed; TypeScript `--noEmit` passed. Coverage includes model routing, retired-selection migration, reasoning/fallback compatibility, context ceilings, pricing coverage, menu/landing metadata, greeting exclusions, worker claim/cleanup contracts, checkpoint startup, and the shared model loop.
