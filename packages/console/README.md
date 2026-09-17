# RIFT Terminal

An independent local coding agent using RIFT models, credits and approval choices. By default the terminal runs its own inspect → edit → verify tool loop directly on your computer. `rift --cloud` uses the durable RIFT Build worker instead. Terminal conversations have their own IDs and history; they do not write to the open app conversation or its Recent list. The desktop app does not need to stay open. The RIFT service and selected execution target must remain reachable.

## Install

Requires Bun 1.3 or later for the OpenTUI runtime and Node 20 or later for build tooling. From this directory:

```sh
npm install --workspaces=false
npm run install-local
rift login
rift
```

For the local UI preview, use `rift --app http://localhost:3020 login` once. Login opens RIFT in the browser and stores a personal API key with owner-only file permissions in `~/.config/rift/console.json`. Revoke it in Settings → API keys. `RIFT_API_KEY` can supply an existing key instead. Keys are never printed in diagnostics.

The installer writes launchers to `~/.local/bin` (override with `RIFT_CONSOLE_BIN_DIR`). Keep the checkout and Bun installation available. An unrelated existing `rift` is preserved unless `node scripts/install-local.mjs --replace-rift` is requested; replacement saves the previous command as a timestamped backup. The package also declares npm `bin` entries for `rift` and `rift-console`.

## Use

Type a task and press Enter. Ctrl+J inserts a newline. Pasted multiline input is not automatically submitted. PageUp/PageDown scroll output. Menus are keyboard accessible.

| Command                                                 | Action                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/model`, `/effort`, `/permissions`, `/mode`, `/target` | Choose the session configuration.                                                      |
| `/approve`, `/deny`                                     | Inspect and decide a pending tool action.                                              |
| `/new`                                                  | Start a separate terminal conversation.                                                |
| `/stop`                                                 | Stop the local task, or cancel the selected Cloud worker.                              |
| `/app`                                                  | Open RIFT.                                                                             |
| `/details`                                              | Expand or collapse complete tool output.                                               |
| `/help`                                                 | Show shortcuts.                                                                        |
| `/quit`                                                 | Save and stop local work. With `--cloud`, close the reader while the worker continues. |

Ctrl+C stops a running task or clears idle input. Ctrl+Q exits. Ctrl+P opens the command palette. Esc dismisses menus. New approval requests open a review menu in the review menu. Approval previews must be reviewed before a decision; Keep waiting is initially selected. A request never silently approves itself.

The local terminal remembers its conversation per service and project directory in `~/.config/rift/sessions` with owner-only permissions. It loads project-root `AGENTS.md` instructions. Only one terminal writes a given session at a time. Reopening restores history and resumes an interrupted model step or built-in file read with the same available model. Completed results stay saved. Unconfirmed writes and commands remain uncertain and are never silently executed again. Explicitly stopped tasks stay stopped. `/new` starts fresh in the same directory. Permission mode resets to Review first on restart.

Local tools read/list files, write or uniquely edit text, and run shell commands. File tools stay inside the project and reject symlink escapes. Reviewed shell commands run with your macOS account's permissions and are not an OS sandbox. Review first asks before writes/commands; Allow edits asks before commands; Run freely executes without those prompts. Ctrl+C stops the local model request and active shell process group. Closing the desktop app does not interrupt the terminal; closing the terminal stops local work.

RIFT's shared Vercel AI SDK `streamText` engine generates one model step on RIFT's authenticated `/api/console/model` endpoint; the CLI executes tools locally after its approval checks. The endpoint aborts generation when its reader disconnects and uses SDK total/idle timeouts. Interrupted or timed-out steps cannot authorize local tool execution. This gateway supplies metered model steps without a Cloud worker or sandbox startup. Local steps use included or prepaid credits, not the monthly free Cloud run. A reachable RIFT service is still required. This gateway is currently implemented in the UI preview checkout; deploying it is required before this CLI can use it on the public service.

`rift --cloud` uses a separate conversation and durable worker. It restores output and retries read-only stream recovery without resubmitting tasks. Its working directory is not mounted automatically; select a configured local runner with `/target` when needed. Cloud worker execution and local CLI execution are separate modes.

## Terminal presentation

Version 0.3.0 uses `@opentui/core` with Bun. OpenTUI owns input editing, mouse scrolling, layout and terminal cell updates. Streaming messages update existing transcript nodes and preserve the draft. Terminal teardown restores the shell. The legacy renderer is only used with explicit `--pair`.

The welcome screen renders RIFT Logo Package 11's approved horizontal vector logo as Unicode braille cells, with a compact symbol in small terminals. The symbol and wordmark keep their original proportions and clear space; the terminal font controls the final cell appearance. Working and reasoning show the same fixed symbol with a monochrome brightness pulse. Set `RIFT_REDUCED_MOTION=1` to keep it still. The human/robot hand illustration remains separate artwork.

`src/terminal-logo.ts` carries the package's exact paths so standalone executables need no SVG or image runtime. Its tests compare the paths with the web's canonical `lib/brand/logo.ts`, check the two sweeps and letter openings, and verify that narrow terminals retain the draft. After branding source changes, rebuild standalone candidates with `npm run build:release`; this regenerates the executable, its `manifest.json` SHA-256, and the platform archive. Existing installed binaries keep their old branding until replaced. This does not require rebuilding the separate `packages/local` receiver download unless its own tracked inputs changed.

`/files` browses the current directory and previews text; inserting a path does not upload it to Cloud. `/skills` and `/plugins` list enabled account resources and show their details. These lists do not enable MCP execution in the local engine; `--cloud` uses the shared Build harness for that. `rift --json models list`, `rift --json skills list`, and `rift --json plugins list` offer scriptable discovery. Resource listing requires a reachable service with the console resources endpoint.

Exit an already running CLI and launch `rift` again after updating. `rift --version` should report 0.3.5.

### Current coverage

Local file editing, shell commands, model/effort/approval selection, saved conversation resume, independent Cloud tasks, and account resource discovery are available. Account project creation, bot management, meetings, Studio UI and marketplace installation are not yet exposed as terminal commands. The CLI is a real standalone terminal client, but does not yet replace every screen of the app.

## Diagnostics and development

`rift --json doctor` prints setup information without making a model request; it does not prove network reachability. The interactive command requires a TTY.

```sh
npm test
bun test test/opentui.test.ts
npm run build
```

`local-client.ts` owns the default local tool loop; `local-tools.ts` runs file/command operations. `independent-client.ts` drives the in-app console and `--cloud` CLI. `standalone-session.ts` handles personal-key login and local session preferences. `opentui.ts` implements the default terminal interface; `commands.ts` shares command parsing. ANSI/OSC control sequences and bidi overrides are stripped from model output before rendering.

`--pair` retains the optional legacy loopback bridge for compatibility. It requires a browser tab and an explicit pairing approval; normal `rift` does not use this bridge.

App and CLI share the model stream boundary, repeated-work detector, and run-scoped tool execution ledger. Local tool calls are validated as a complete batch before execution. Changed read results count as progress; repeated failures receive a strategy warning before the loop stops. Confirmed local results remain checkpointed individually. These protections do not claim exactly-once execution across a process crash.

## Standalone release candidates

`RIFT_BUN_PATH=/path/to/bun npm run build:release` creates a self-contained executable and a platform-specific tarball under `release/`. The installed executable does not need this checkout, Node, or Bun. Run `node scripts/smoke-release.mjs` to test installation into a separate temporary directory, isolated settings, help, update backup, and checksum rejection. Run `python3 scripts/verify-pty.py /absolute/path/to/release/rift` on macOS/Linux to verify that the standalone binary renders in a real terminal, exits on one Ctrl+C while idle or holding an unsent draft, and restores terminal attributes. This probe uses isolated settings and never starts a model task.

Extract the archive and run `node install.mjs`. The installer currently requires Node; the installed program does not. For updates, run `node install.mjs /path/to/extracted-release --replace`; the previous executable is retained as `~/.local/bin/rift.previous`. Checksums detect damage; they are not publisher signatures. These candidates are not notarized or publicly published yet.

`RIFT_APP_URL` selects the service when `--app` is omitted. `RIFT_CONFIG_DIR` isolates configuration for tests or separate accounts. `rift --json doctor --online` validates account access to the configured service. The public service must expose `/api/console/config`, `/api/console/resources`, `/api/console/model`, `/api/console/stream`, and the browser CLI login page before public onboarding works. On 2026-09-14 the public config route still returned 404; public release is blocked pending a verified production deployment.

The manually triggered `RIFT CLI release candidates` CI workflow builds and uploads candidate artifacts on Apple Silicon Mac, Intel Mac, and Linux x64. Those platforms are only verified after their CI jobs pass; only the local Apple Silicon build has been executed here. No automatic public publication or silent auto-update is configured.

Version 0.3.1 starts a new session by default in both local and Cloud modes. Use `rift --resume` (or `rift --cloud --resume`) to restore the latest session. Previous histories are retained. Independent fresh local sessions can run in the same directory; explicitly resuming an already active session remains locked. The opening screen is compact for small terminals, and config requests time out after 10 seconds.

Version 0.3.2 adds a brighter graphite palette and responsive welcome screen. Type `/` to open command suggestions immediately, keep typing to filter, use arrow keys to select, and Enter/Tab to open. Escape dismisses. Suggestions run locally without network requests. `/cloud` and `/local` start a new execution session after confirmation; switching is blocked during a running task or approval. `/tools` explains actual coverage. Terminal font selection remains controlled by the host terminal.

### Conversation controls (0.3.4)

User messages have a separate charcoal surface; reasoning uses lavender, tool activity uses teal, and errors use rose. Completed bold spans in assistant text are rendered with emphasis. `/effort` previews the model’s supported intensity levels with a RIFT spectrum: use left/right and Enter to apply, Escape to leave unchanged.

The Local agent can call `ask_question` with 2–6 options. Choose an option, review and send it, or write a custom answer. `/question` reopens a dismissed question. An unanswered question is never treated as approval; Stop interrupts it. This interactive tool is currently Local-only; Cloud question integration remains pending.

Ctrl+C exits immediately when idle, including with an unsent draft or open menu. During work, the first Ctrl+C requests Stop; a second Ctrl+C exits. Ctrl+Q also exits.
