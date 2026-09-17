# RIFT terminal: native Codex execution with RIFT account billing

## Requested result

The terminal inside the RIFT desktop application should execute tasks with the real Codex engine. The user keeps the existing RIFT account and credits. A separate ChatGPT login is not the intended solution.

## Verified current state

- Running application: `/Applications/RIFT UI Preview.app`, backed by `/Users/cetto/RIFT-Release` on `127.0.0.1:3020`.
- The RIFT console panel renders `RiftAgentConsole` → `useRiftConsoleRuntime` → `IndependentConsoleClient`.
- `/api/console/stream` delegates to the existing durable Cloud Build worker. It does not execute the local Codex binary.
- `/Users/cetto/RIFT-Codex-CLI` contains the full OpenAI Codex source at `a8964cb1bad67bc26a826fb07d1bef99c6a3f008`, with existing RIFT branding and state changes. Its Git remote is `https://github.com/openai/codex.git`.
- A native debug build succeeded and a local fixture response passed. The package reports a missing `codex-code-mode-host` helper, so complete tool use is not yet verified. The native package must include and test that companion executable.
- The installed `~/.local/bin/rift` reports 0.3.5 and is the older console implementation. Replacing this executable alone will not change the app console.
- `~/.rift/config.toml` belongs to an older application and defines `model` as a table. Native Codex expects an optional string. It must not be reused as native configuration.
- The existing `/api/console/model` accepts AI SDK messages and a fixed local tool schema. It is not a Codex Responses API endpoint.
- Three existing reader defects were reproduced and fixed separately: a transient resume request exhausted recovery prematurely; an in-flight resume response could update a stopped session; reopening a failed dock retained the failed client without reconnecting. Recovery now also runs when the browser reports the network is back, without restarting a live task. The console suite (62 tests) and app runtime suite (8 tests) passed after the fixes.

## Options

1. **Recommended: native app-server with the existing RIFT console UI.** Run the pinned RIFT/Codex binary as an app-server and map its structured notifications into the console. This preserves the app interface and makes Codex own agent execution. It requires a desktop process bridge and a metered Responses gateway.
2. Embed the native Codex TUI in the existing desktop PTY terminal. This gives the closest keyboard/menu behavior but replaces the current console presentation. It still needs the same RIFT billing gateway.
3. Continue improving the Cloud Build agent. This avoids a new engine integration but does not provide actual Codex behavior and therefore does not meet the full request.

## Recommended implementation

### Native process and lifecycle

- The desktop runtime owns the native app-server process; React components only attach readers.
- Store native state under `~/.rift/codex-native`, isolated from both legacy RIFT configuration and `~/.codex`.
- Use the existing desktop account ownership and workspace grant mechanisms to bind each session to an authenticated RIFT owner and selected project directory.
- Closing the dock or navigating to another conversation detaches the reader, not the running task. Explicit Stop interrupts the turn. Signing out detaches the account and prevents a later account from receiving its events.
- A process failure is shown explicitly. Resume reconstructs the saved Codex thread; uncertain shell commands are not automatically replayed.

### App console integration

- Introduce a native console client behind the existing snapshot/command interface.
- Map model selection, reasoning effort, text submission, approvals, user questions, interrupt, new session, and resume to public app-server methods.
- Map streamed assistant output, command output, file edits, approvals, errors, and completed turns to console entries.
- Persist the native thread ID by account and workspace, separate from existing Cloud Build chat IDs.
- Preserve the current Cloud Build path until native acceptance checks pass. Migration must be explicit in UI state: the displayed engine and workspace must match the process actually running.

### RIFT identity and metered Responses gateway

- Add a dedicated authenticated Responses endpoint. Do not redirect Codex to the existing AI SDK `/api/console/model` endpoint.
- Reuse RIFT's account identity, suspension checks, model allowlist, rate limits, pricing, credit admission, usage settlement, and failure reconciliation.
- Keep provider credentials on the service. The desktop uses a scoped RIFT credential rather than an OpenAI or OpenRouter provider key.
- Proxy validated Responses input and tool declarations without replacing Codex's tools with the legacy five-tool schema.
- Validate provider compatibility for native function calls, custom tools, reasoning continuation, streaming events, and token usage. OpenRouter documents a Responses endpoint, but that alone is not proof of complete Codex compatibility.
- Restrict the first supported model set to models that pass the actual protocol checks. Do not silently switch a requested model.
- Give every model attempt a durable billing identity. Retries and stream reconnects must not settle the same attempt twice. Do not emit successful completion until required usage reconciliation succeeds.
- Reader disconnection must not be mistaken for a new billable task.

### Deployment and reversibility

- Package the native binary with source commit and checksum provenance, license, and notices.
- Stage and verify the binary before changing the app's active engine.
- Keep legacy settings, conversations, and installed executables recoverable.
- Do not replace the standalone `rift` command as a substitute for the app integration.
- Verify the local preview first; publishing the hosted gateway or production desktop build is a separate release action.

## Acceptance checks

1. RIFT account authentication succeeds without a separate ChatGPT login.
2. The selected project is the actual execution directory; an ungranted directory is rejected.
3. A task reads a fixture, proposes a file edit, receives approval, applies the edit, runs a check, and reports the observed result.
4. Denied operations remain denied; a follow-up cannot bypass the permission decision.
5. The console remains responsive while the model thinks and while a shell command runs.
6. Dock close/reopen and route navigation reattach to the same task without creating another task or charge.
7. Network failure and app-server reconnect preserve thread and draft state. Stop followed by a new task cannot revive the old reader.
8. Process interruption preserves completed tool results and does not replay uncertain writes.
9. Provider failure, cancellation, duplicate completion, and settlement retry produce correct account usage exactly once per billable attempt.
10. Account switching isolates credentials, transcripts, approvals, and native process ownership.
11. Text, shell, edit, resume, model/effort selection, and MCP behavior are tested against the packaged native binary, not only mocks.

## Scope boundaries

This migration replaces the desktop console's execution engine. It does not rewrite the main chat, Studio, billing plans, or unrelated application screens. Existing remote targets need explicit native exec-server integration before they can be offered as native Codex targets.

## Evidence

- Local implementation files above are the source of truth.
- OpenRouter Responses endpoint documentation: https://openrouter.ai/docs/api/api-reference/responses/create-responses
- Native API protocol: `/Users/cetto/RIFT-Codex-CLI/codex-rs/app-server/README.md` and `app-server-protocol`.
