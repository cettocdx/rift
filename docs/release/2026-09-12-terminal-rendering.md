# Terminal output completion and real-renderer acceptance

The remote Workbench terminal could show `Exited` while the last xterm write
was still pending. A single SSE read containing two output events and an exit
reproduced this with the first renderer callback withheld. Native terminal
completion already waited through its output drain. Remote completion now also
follows the final renderer callback and checks ownership before updating the UI;
input stops as soon as exit arrives.

Independent review exposed a second failure path: a synchronous xterm write
exception could leave the terminal appearing Connected, or be swallowed before
a later write. Two renderer-exception regressions failed before the follow-up
fix. Renderer write/reset failures now terminate ownership, stop input and
mutations, and show an output-rendering error. Later queued writes or exit
callbacks cannot replace that error with success.

## Actual xterm browser coverage

The isolated terminal fixture bundles the production
`WorkbenchInteractiveTerminal`, xterm, fit addon, input/output drains and terminal
CSS. Native transport and app providers are synthetic; no shell, model, auth or
backend is called. The producer follows the native one-batch/ACK contract.

Eight cases passed across Chromium/WebKit, 1200/390 CSS pixels, and light/dark
colors. Each emitted 13,056,014 UTF-8 bytes in 640 deliveries over roughly
12–13 seconds. The terminal accepted input before and during output, forwarded
Ctrl+C, kept parsing when its host was hidden, resized, retained the separate
fixture draft and reached the final Unicode/end marker and Exited 0. Scrollback
stayed within 5,000 rows plus viewport rows.

This verifies actual renderer consumption and interactive controls at the
component boundary. The producer itself waits for ACK, so this is not an
independent proof of native IPC backpressure. Byte totals count produced bytes;
all ACKs and the final buffer tail are asserted, not every historical line.
The draft is an ordinary input and the host is an isolated section, not the
whole chat/dock. Touch viewports are simulated, not physical phones.

The first matrix overlapped manual native UI use. Its isolated long frame gaps
cannot be assigned to application code. A subsequent quiet WebKit desktop pair,
without native interactions, build or trace recording, passed again:

| Theme | RAF p95 | RAF p99 | Maximum | Gaps above 50 ms |
| ----- | ------: | ------: | ------: | ---------------: |
| Light |   18 ms |   18 ms |   33 ms |                0 |
| Dark  |   18 ms |   19 ms |   29 ms |                0 |

These are observations of one paired run with synthetic transport, not a
performance threshold, native benchmark or competitor parity result. The
fixture records frame timestamps and ACK positions before screenshots.

## Installed native observation

The installed RIFT UI Preview Shell produced 12 groups of `seq 1 3000`, with a
one-second pause between groups. Switching to RIFT console during execution and
returning showed `RIFT_NATIVE_DONE` and the prompt. Ctrl+C interrupted a separate
`sleep 30` command; the following `printf` produced `RIFT_INPUT_READY` and a prompt.
These are actual native PTY interactions, not a byte-exact capture or timing
benchmark. No model was called and no file was created by those commands.

The compact native terminal header still wrapped `RIFT console` onto two lines
at the observed narrow panel width. That is a separate confirmed visual follow-up.
Long-duration agent/provider recovery, native downloading, physical mobile
keyboards and whole-product release acceptance remain open.

Reproduce browser coverage:
`pnpm exec playwright test -c e2e/mobile-fixture/playwright.terminal.config.ts`.
Preserved evidence: `/Users/cetto/RIFT-Reports/evidence/2026-09-12-terminal-rendering/`.

Focused lifecycle validation passed 25 tests in four suites, including nine
remote output/exit tests. Independent follow-up review found no blocking issue.
The final eight browser cases also passed after the renderer-error fix.
