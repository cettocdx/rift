# RIFT source-built CLI acceptance — 2026-09-16

## Delivered

- Source fork: `/Users/cetto/RIFT-CLI`, branch `rift-cli`, commit `80d03de`.
- Upstream OpenCode v1.18.31, SHA `014614d35b397775e5d397a490fc72368c894ec2`.
- Installed RIFT CLI version0.5.0. `~/.local/bin/rift` launches the source-built RIFT engine for every supported model. `rift opencode` and `rift exec` are compatibility aliases.
- RIFT wordmark, help, terminal title, permission/error text, account guidance, product links and usage billing label. Original license is retained; internal upstream package/protocol identifiers stay compatible.
- One model menu contains GPT Sol/Astra, Gemini, Claude Opus/Fable, Grok, Kimi, GLM and Hunyuan. Explicit model selection wins; menu selection persists on restart.
- Login uses the RIFT browser callback directly and reuses existing saved credentials. Parent retains account credentials; engine receives an ephemeral loopback nonce.
- Existing credit authorization and settlement remain in the RIFT gateway. OpenCode config now returns all nine accepted models, model-specific input caps and reasoning metadata.

## Verification

- Fork Python suite:19/19 passed, covering browser callback origin/host/nonce, private atomic credential save, immutable installer rollback, one-engine routing, input/reasoning limits, history backup and real stalled-header relay shutdown.
- TUI suite:199passed,1upstreamskip. CLI help:34snapshots. RIFT help test:28assertions. Direct-mode permission/theme tests:12passed. CLI error tests:6passed. Both CLI and TUI package typechecks passed.
- RIFT gateway config/Responses suites:45/45passed; scoped lint and full TypeScript passed. Local preview production build passed and activated through the existing3020LaunchAgent.
- Existing native/OpenCode relay regression suite:35/35passed, including the official OpenCode failure adapter cases. The fork additionally fixes shutdown while upstream response headers stall; the actual HTTP regression failed before and passed after the socket shutdown fix.
- Source binary build succeeded; installed version/help and bundle checksums verified.

## Live account and terminal evidence

- Claude Fable read `value.txt` using the actual read tool, continued, returned `RIFT_FABLE_OK 41`, exit0.
- GPT Sol used the same engine, read the file, continued, returned `RIFT_GPT_OK 41`, exit0.
- GPT session `ses_f5472b5f0ffeZedi0tnBdZ3SEZ` resumed with Fable; read and continuation returned `RIFT_SWITCH_OK 41` in the same session, exit0.
- Actual TTY `/models` showed both GPT entries alongside the non-GPT catalog. GPT selection was restored when the installed `rift` reopened.
- Installed TTY requested separate one-time approvals for writing `proof.txt` and running `cat proof.txt`. After each approval, the write and command succeeded, output `RIFT_WRITE_OK`, final response Done. Ctrl+C closed the tested TTY cleanly.
- Successful live Responses turns pass the existing gateway settlement gate before completion/tool events are emitted. Token usage and completion were observed; no independent before/after account balance audit was performed.
- Fixture pointer: `/tmp/rift-fork-acceptance-location.txt`; live logs `/tmp/rift-fork-{fable,gpt,switch}.jsonl`; regression logs `/tmp/rift-fork-python-tests.log`, `/tmp/rift-relay-regression.log` and build logs `/tmp/rift-fork-final-build.log`, `/tmp/rift-fork-gateway-build.log`.

## Installation and compatibility

Immutable bundles live in `~/.local/share/rift-cli/versions/`; prior entrypoints are retained in `backups/`. The older dual-engine bundles and global OpenCode remain intact. Session storage is owner-isolated under `~/.rift/cli/<hash>/`. Compatible old OpenCode data is copied once using SQLite backup; `OPENCODE_DISABLE_CHANNEL_DB=1` preserves the compatible database filename in the new private directory. Old Codex history is retained separately.

## Boundaries

- Standalone CLI migration only; the desktop embedded console remains the separate earlier client.
- Local service origin remains `http://localhost:3020`. This release has not been publicly deployed or pushed.
- Current gateway supports text/tool messages. Image/file multimodal input is not exposed. Reasoning effort variants are available; toggle-style on/off reasoning controls remain hidden.
- All nine models are visible, but only GPT Sol and Claude Fable received live paid tool tests in this task.
- Cold account handshakes can take up to45seconds. Requests with uncertain outcome are never replayed automatically.
- Project provider/plugins, external skills, remote attachment, auto-approval overrides and upstream account/update routes remain disabled in this RIFT-account build.
