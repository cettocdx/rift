# Interactive OpenAI Build latency routing

OpenAI Build requests in agent mode now send OpenRouter `provider.sort=latency`.
The selected model, reasoning effort, existing fallback list and account gates
remain intact. Other model families and ordinary Ask mode retain existing routing.
This is an upstream preference, not a deadline or guaranteed first-token time.
It may select a different eligible upstream with different pricing/cache behavior.
Provider safety filters are not disabled or bypassed.

Primary reference:
https://openrouter.ai/docs/guides/routing/provider-selection
Read-only model endpoint discovery returned multiple OpenAI and Azure endpoints
and an Amazon Bedrock endpoint for the measured model. Latency values were null;
no endpoint-specific speed ranking was inferred from that response.

54 focused fallback/model-runtime tests passed after a new latency routing test
failed on the previous implementation. TypeScript and scoped ESLint passed.
The active development worker hot-reloaded as `20260914.17`; the web production
bundle and public production worker were not rebuilt/deployed for this change.

## Live exploratory measurements

Same `build-codex` model, medium effort, persisted mixed scenarios:
`/tmp/rift-startup-routing-20260914.json`.

| Scenario    | First text | Admission | Dispatch to handler | Handler to model | Model to first chunk |
| ----------- | ---------: | --------: | ------------------: | ---------------: | -------------------: |
| Greeting    |    7729 ms |   1870 ms |             2843 ms |          1402 ms |              2066 ms |
| Explanation |    6476 ms |   1652 ms |              960 ms |          1068 ms |              3279 ms |
| Terminal    |   18382 ms |   2889 ms |             2106 ms |          2474 ms |              4975 ms |

All completed with verified scenario evidence and zero duplicate observed events.
Terminal's first text follows its requested command; use the tool-input timing
for earlier progress, not this final-text metric. These small samples under
uncontrolled host/provider load do not prove causal gains from routing. In
particular, lower admission time is not caused by an upstream routing setting.
Four-second target remains unmet. Follow-up samples recorded separately.

## Repeat (same configuration)

Evidence: `/tmp/rift-startup-routing-repeat-20260914.json`.

- greeting: first text 8605 ms; admission 2747 ms; dispatch to handler 2670 ms; model wait 2139 ms; verified true; duplicates 0.
- explanation: first text 8169 ms; admission 2004 ms; dispatch to handler 914 ms; model wait 3898 ms; verified true; duplicates 0.
- terminal: first text 12968 ms; admission 2045 ms; dispatch to handler 1486 ms; model wait 8262 ms; verified true; duplicates 0.

Six total runs completed and verified across two rounds. This is still only two
samples per scenario, not a percentile/SLO or cold-start acceptance result.
