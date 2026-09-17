# RIFT OpenTUI CLI verification

- Package: @rift/console 0.3.0, @opentui/core 0.5.11, Bun 1.3.14.
- Installed command: ~/.local/bin/rift uses Bun and this checkout's dist/index.js.
- Real PTY started from /tmp, submitted `Reply with exactly OPENTUI READY. Do not use tools.`, received `OPENTUI READY`, exited Ctrl+Q with exit code 0 and shell restoration.
- Latest package build and 51 existing console tests passed.
- Two native OpenTUI tests passed (10 assertions): keyboard input does not submit, Enter sends once, streaming/resize preserve draft, opening/dismissing approval does not approve.
- Four resource API tests passed: auth, resource validation, credential allowlist, backend error redaction.
- Whole app `pnpm exec tsc --noEmit --pretty false` exited 0.
- Installed command from /tmp fetched models, enabled skills and MCP metadata from localhost:3020 successfully.
- Offline doctor reports OpenTUI/Bun and saved personal-key auth; no keys printed.

## Coverage boundaries

Real standalone local file/shell agent and independent durable Cloud task client. No default browser pairing; the optional legacy --pair renderer remains explicit. Resource listings are discovery, not automatic local MCP execution. Local file path insertion does not upload files. Project account administration, bot/meeting management and Studio/marketplace workflows are not yet terminal commands. No claim of complete app parity or measured competitor performance parity.
