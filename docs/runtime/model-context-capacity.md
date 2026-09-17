# Context capacity

Verified on 2026-09-08 against the actual OpenRouter model IDs in `BUILD_MODELS` and the gateway's public models/endpoint metadata. RIFT routes these models through OpenRouter, rather than directly to each vendor.

| Model IDs | Total window | Gateway prompt ceiling |
| --- | ---: | ---: |
| `openai/gpt-5.6-sol`, `openai/gpt-5.6-sol-pro`, `openai/gpt-5.6-luna` | 1,050,000 | 922,000 |
| `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5` | 1,000,000 | Window minus output |
| `x-ai/grok-4.6` | 500,000 | Window minus output |
| `moonshotai/kimi-k3` | 1,048,576 | Window minus output |
| `qwen/qwen3.8-max` | 1,000,000 | 983,616 |
| `z-ai/glm-5.3`, `tencent/hy4-preview` | 1,048,576 | Window minus output |
| `x-ai/grok-4.3` (security route) | 1,000,000 | Window minus output |

The Qwen alias is absent from the aggregate model list but resolves through its official endpoint metadata to Qwen3.8 Max (0902). GLM's aggregate model maximum is larger than some endpoints; RIFT retains its existing, more conservative 1,048,576 catalog capacity. No new capacity is inferred for unknown or retired IDs.

Sources:

- [OpenRouter model metadata](https://openrouter.ai/api/v1/models) and [model metadata documentation](https://openrouter.ai/docs/api/api-reference/models/get-models).
- [Sol endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-5.6-sol/endpoints), [Sol Pro endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-5.6-sol-pro/endpoints), [Luna endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints).
- [Qwen alias endpoint metadata](https://openrouter.ai/api/v1/models/qwen/qwen3.8-max/endpoints), [GLM endpoint metadata](https://openrouter.ai/api/v1/models/z-ai/glm-5.3/endpoints).
- [OpenAI Sol model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [OpenAI Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Claude model overview](https://platform.claude.com/docs/en/models/overview), [xAI Grok 4.6 documentation](https://docs.x.ai/developers/models/grok-4.6).
- [OpenRouter routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection): requested output length filters providers. RIFT also filters model fallbacks against the estimated input size, avoiding a smaller model during a long-context turn.

## Budget rules

`lib/token-limits.ts` is the shared source for client validation, history preparation, runtime compaction, fallback eligibility and context indicators. Total capacity is distinct from the usable prompt budget:

- A free account without prepaid balance retains the existing 128,000 total cap.
- Paid entitlements and a server-verified positive prepaid balance use the selected model's window. The client reads authenticated balance metadata; the server independently rechecks it. This flag does not authorize spending or bypass budget checks.
- The existing output limit remains 30,000 for paid tiers and 15,000 for free/PAYG. Input capacity is the smaller of total window minus output reserve and the provider's prompt-only maximum.
- History and initial input leave another 8,192 tokens for instructions and tool metadata assembled later. Runtime compaction uses actual system tokens and provider-reported usage when available. Tokenization remains an estimate and is not a guarantee that arbitrary attachments fit every provider.
- Compaction starts at the smaller of 90% of the window or the available input budget. The former hard-coded paid 200k is now only a conservative unknown-model fallback.
- Existing file-upload ceilings and billing/rate-limit policies are unchanged.
- History retrieval uses 24-message pages, bounded to 4–24 pages according to model capacity, instead of always stopping after 96 messages. It stops earlier when the token budget is full or the database is exhausted. This is a resource bound, not an unlimited-history promise.
- A custom profile or canary model that changes capacity causes history to be prepared again before persistence and file processing, so a larger model does not inherit the smaller selection's truncation.

Metadata is checked into the catalog, not fetched on the first-token path. Update and reverify it when changing model IDs or gateway routes. The smaller window of a fallback is considered before sending; unavailable or incompatible providers are not silently granted a larger window.
