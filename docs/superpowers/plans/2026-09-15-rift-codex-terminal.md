# RIFT native Codex terminal implementation plan

**Goal:** Execute the existing desktop console with the pinned native Codex app-server, retaining RIFT identity and credit accounting.
**Spec:** ../specs/2026-09-15-rift-codex-terminal-design.md (approved).
**Architecture:** Desktop-owned app-server plus an authenticated loopback model relay to a metered RIFT Responses endpoint; existing console snapshot/command UI.
**Technology:** Next.js/TypeScript, Tauri/Rust, Python packaging, upstream Codex JSON-RPC v2.

## Global constraints

- Work in the existing feature branch because the running preview and earlier recovery fixes use this checkout. Preserve all unrelated dirty changes. Do not commit or stage unrelated files.
- Never expose RIFT/provider keys in logs, JS, arguments or tool environment. A process-scoped nonce grants only access to the metered model relay. Keep native state in ~/.rift/codex-native, not legacy ~/.rift/config.toml or ~/.codex.
- Use existing desktop owner generations and writable workspace grants. Account changes revoke process access. Detaching the panel does not kill work.
- No model substitution, unmetered fallback, successful completion before settlement, or automatic replay of uncertain tool writes. Existing cloud path stays available until native acceptance passes.
- Tests must reproduce behavioral defects before fixes; validate actual packaged binaries as well as mocked protocol contracts.
- Local preview installation is authorized; public publishing is outside this implementation.

### Task 1: Metered native Responses service

**Ownership:** New app/api/console/native/config/route.ts, app/api/console/native/responses/route.ts, their tests, lib/ai/native-responses* and lib/billing/native-console* if needed. Do not modify desktop/client/package files. Shared billing modifications only when necessary and documented; preserve other dirty work.

- [x] Inspect existing app/api/console/model/route.ts and tests, AccountCreditLifecycle and provider routing as authoritative examples.
- [x] Add GET /api/console/native/config authenticated through getUserIDAndPro(req), suspension check, returning { ownerId, models: [{id,label,providerModel,efforts}], defaultModel }. Start with explicit OpenAI compatible model allowlist; return RIFT model IDs and resolve server-side provider models without accepting arbitrary upstream URLs.
- [x] Add POST /api/console/native/responses using the same authentication, entitlements and pricing policies. Desktop relay injects existing RIFT API key; no new login scheme required on server. Receive Responses JSON with model=RIFT ID, stream=true, native tools and continuation preserved. Bound body and context. Reject unsupported modalities/server-side tools and invalid model/reasoning, without flattening function/custom tools.
- [x] Forward to the configured OpenAI-compatible provider's Responses endpoint with server-only credentials. Inspect existing provider config first: use its actual endpoint/model mapping, not an invented model URL. Browse primary provider docs if needed. Do not log credentials or request contents.
- [x] Reuse current admission/settlement machinery, retaining free/paid/organization handling and keyed-credit feature gating. Each model attempt gets a server-generated durable lifecycle identity; no caller-controlled billing binding. Transport must not replay a started request. Duplicate terminal events and settlement retries must not double charge. If full durable semantics cannot be achieved with existing non-keyed paths, explicitly fail closed for unsupported paths and report the limitation rather than invent unsafe billing.
- [x] Parse SSE incrementally with bounded buffering; accumulate reliable terminal usage, preserve native response items/reasoning/function/custom-tool events. Hold response.completed until settlement succeeds. Cancellation/provider error/absent usage reconcile through existing lifecycle; never emit successful completion on settlement failure. Usage logging failure after successful settlement must not debit again.
- [x] Add focused tests for unauthenticated/suspended/invalid model/body, tool and reasoning preservation, streaming before finish, duplicate completion, interrupted stream, missing usage, settlement failure/retry, provider rejection. Mock external provider and billing; no paid smoke tasks in this subtask.
- [x] Run scoped Jest tests and relevant typecheck. Write a report listing files, tests, supported protocol/model/account limits and integration details. Do not commit (existing dirty checkout and precommit hook need controller review).

### Task 2: Complete native binary package

**Ownership:** /Users/cetto/RIFT-Codex-CLI/scripts/rift/build.py and package tests; RIFT desktop staging script.

- [x] Build both codex-cli/codex and codex-code-mode-host with upstream verified V8 archive environment. Preserve existing cached host target.
- [x] Stage rift and helper side by side, license/notice and SHA256 manifest including pinned upstream commit. Verify bundle before desktop uses it.
- [x] Exercise real CLI and app-server against local Responses fixtures including tool execution. Do not replace ~/.local/bin/rift.

### Task 3: Desktop app-server process and scoped relay

**Ownership:** packages/desktop/src-tauri/src/native_codex\*.rs and lib.rs registration.

- [x] Add managed native state bound to existing terminal owner generation and writable workspace grant. Resolve binary from verified desktop resources; development override restricted to process environment, never frontend arbitrary path.
- [x] Read existing RIFT console login in native code. Authenticate GET native/config and require returned ownerId to equal current owner before starting. Keep personal key in relay only; give child an ephemeral nonce scoped to Responses route. Fixed authenticated gateway origin; disable redirects. No key in child env.
- [x] Start app-server using stdio JSON-RPC and isolated RIFT_HOME by owner/workspace. Implement attach, bounded event replay/sequence, request/response forwarding, detach and explicit process close. Whitelist necessary public thread/turn/model APIs and approval responses; force granted cwd and safe sandbox defaults.
- [x] Existing account owner change kills old processes and relay, clears replay and rejects stale generations. Detach leaves process alive. Process failure is explicit and never auto-replays turns.
- [x] Test owner/grant rejection, replay bounds, parser fragmentation and approval routing; cargo check scoped desktop.

### Task 4: Native console client and panel integration

**Ownership:** packages/console/src/native-client.ts, app/services/desktop-native-console.ts, terminal native hook/picker and tests.

- [x] Adapt public JSON-RPC v2 notifications to ConsoleSnapshot/ConsoleCommand. Map thread start/resume, turn start/interrupt, command/file approvals, questions, item deltas, errors and completion. Track IDs to reject stale outputs and duplicate starts.
- [x] Use desktop workspace grants and owner service; retain clients by owner/workspace across React mounts. Persist native thread ID separately from cloud IDs. Display actual engine/workspace. Show clear setup state when no grant or RIFT login exists.
- [x] Preserve current Cloud client until native binary+gateway checks pass, then default desktop console to native. Model IDs/efforts come from native/config. Native only advertises local workspace execution.
- [x] Tests cover stop/race, remount/reattach, approvals denied, question answers, account switch, native failure and no silent cloud fallback.

### Task 5: Acceptance and local preview installation

- [x] Run targeted suites, typecheck, scoped cargo checks and binary protocol smoke. Review all task diffs for spec compliance and correctness.
- [x] Bundle helper and verified native package into desktop app, build and install local preview preserving identity and other settings.
- [x] Use the current RIFT account for a bounded fixture task: read, approved edit, denied command, check, dock reattach and same-thread follow-up. Observe gateway accounting and verify no duplicate submission from remount.
- [x] Record actual results and remaining provider/MCP limits; only report native migration complete after app acceptance passes. Do not publish public services/builds.

Acceptance completed for the local preview on2026-09-15; exact evidence and limitations are recorded in ../reports/2026-09-15-rift-codex-terminal-acceptance.md. Approval denial was validated with a file patch; the UI Stop check establishes turn interruption and subsequent submission, not termination of the already-finished30-second shell command.
