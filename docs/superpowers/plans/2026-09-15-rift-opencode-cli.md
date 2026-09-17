# RIFT OpenCode Terminal Plan

**Goal:** Add OpenCode as the terminal engine for the currently verified non-OpenAI RIFT Build models while Codex serves GPT models; retain existing RIFT identity/credits.
**Architecture:** Reuse metered native Responses gateway plus nonce relay. Keep Codex model metadata/config GPT-only, add a distinct OpenCode catalog. Launcher selects engine explicitly (`rift opencode`) or via known non-GPT `--model` selection; default `rift` remains Codex. Official OpenCode1.18.31 arm64 release is downloaded and its SHA256 matches GitHub release metadata; existing1.18.15 remains untouched.

## Global Constraints

- User explicitly requested OpenCode alongside Codex with non-OpenAI models. Same RIFT account/credit preference persists.
- All actual model requests go through existing authenticated keyed lifecycle; no alternate provider/account fallback, no automatic request replay, no successful executable tool events before settlement.
- Long-lived RIFT key stays parent; child gets ephemeral nonce. Isolate OpenCode XDG config/data/cache/state per RIFT owner from existing installation and project provider overrides. Do not modify user global OpenCode settings.
- Default permissions ask for writes/commands; text local tools only. Do not enable sharing, external agents/plugins or inherited provider credentials implicitly.
- Preserve existing Codex config/model mapping and desktop operation. Work in existing dirty feature checkout; no commits, no publicpublish. Installation and localpreviewactivation authorized.

## Task1: Gateway compatibility and actual OpenCode wire capture

Files: lib/ai/native-responses.ts; new app/api/console/opencode/config/route.ts +test; focused nativeResponses regressiontests; new packages/desktop/scripts/verify-opencode-responses.py (if needed).

- [x] Capture a request from actual installed OpenCode with isolated config and local fake Responses server (no paid call). Prefer provider npm @ai-sdk/openai. Research memo /tmp/rift-opencode-integration-research.md includes source references.
- [x] Keep NATIVE_MODELS GPT-only. Add OPENCODE_MODELS for verified BUILD_MODELS non-GPT (exclude qwen/qwen3.8-max until its availability is established), acceptedResponses registry union; separate OpenCode config response ownerId/models/defaultModel, same nativeAccess eligibility.
- [x] Add only observed/justified OpenAI Responses SDK schema compatibility (bounded nullable fields, stateless store:false, local functiontools). Reject unsupported hosted/media/stateful features. No weakened schema or billing/event bounds.
- [x] Reproduce captured request rejection in test, minimally fix, run existing native gateway/namespace suites and newconfig tests. Local fake two-leg functiontool continuation with real OpenCode must succeed, not merely texthello.

## Task2: Engine launcher extension

Files: packages/desktop/scripts/native-cli.py, install-native-cli.py, test_native_cli.py plus opencode_cli.py/helpertests as needed.

- [x] Use Task1 catalog and existingRelay with generated OpenCode config OPENCODE_CONFIG_CONTENT/isolatedXDG and fixed nonce provider. Store false, output16384; explicit small_model throughsameRIFTengine. Use official checksum-verified OpenCode1.18.31 bundle and privately pin it forstableentrypoint.
- [x] `rift` remainsnativeCodex, `rift opencode` opensnonGPTpicker; knownnonGPT -m/--model mapsautomatically. Preserve args/cwd; no hiddenfallback. Clear errors for unsupported combinations.
- [x] Normalize OpenCode transport failure: preheaders HTTP400 OpenAI invalid_request_error JSON; midstream top-level SSE {type:"error",sequence_number:1,error:{type:"invalid_request_error",code:"rift_response_uncommitted",message:"RIFT model request did not complete. Retry explicitly when ready.",param:null}} then clean close. Convert response.failed/incomplete, malformed/missing terminal completion and upstream disconnects; never rawforward those. Bounds remain8MiBframe/32MiBstream. Actualinstalled1.18.31loopprobe must show one main request (automatic title is separate), no replay.
- [x] Add behavioraltests for engine selection/isolation/models/cleanup/installerpreservation and actual OpenCode failure retry; focusedreview.

## Task3: Build, install, live acceptance

- [x] Build immutableNextpreviewonce afterTask1stable; activateonlyafterchecks and noactivepaidturninterruption.
- [x] Atomicallyupgradeentrypoint retaining original0.3.5 backup, config/historypreserved.
- [x] Actual Codex read-onlyexec +TTY verified; actualOpenCode non-GPTtoolreadandcontinuation verified throughRIFTgateway, meteredcompletion; document exactmodels tested andlimitations.
