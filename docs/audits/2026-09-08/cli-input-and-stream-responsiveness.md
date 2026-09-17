# RIFT CLI input and stream responsiveness — 2026-09-08

Scope: the standalone `packages/console` CLI in the UI preview checkout. User reference: the 02:22:02 recording. Version installed locally: 0.2.0.

## Observations and causes

- Input and streaming frames shared a timer with slower decorative animation. A pending welcome animation could delay typing by up to 350 ms; working animation could delay it by 80 ms.
- A cold transcript layout traversed all history. The controlled 200-entry, long-output benchmark took approximately 200 ms for its first frame.
- Tool rows replaced useful operation/path summaries with raw output, making the transcript hard to follow.
- Approval requests were easy to miss behind the slash-command hint.
- The top-right execution label repeated technical information; the process name exposed the long Node entrypoint path in the native terminal title.

## Changes

- Input, stream and decorative frame scheduling are independent. Keyboard edits request an immediate frame; stream bursts coalesce. Decorative animation no longer holds an input update.
- Only visible transcript history is laid out. Only changed rows are written; stdout backpressure discards obsolete frames instead of accumulating them.
- The native terminal cursor follows the input insertion point, including wrapped/multiline input. It replaces the drawn cursor character.
- Tool rows show short operation and file summaries; `/details` exposes complete captured output. Tool results supplied to the model remain unchanged.
- New approvals open a review menu when no menu or input draft is active. Cancel remains selected by default and review requirements remain enforced.
- Removed redundant top-right text; process name is `rift`, window title is `RIFT Terminal`.

The existing local CLI loop runs its own files, reviewed commands, approvals and directory-scoped history. It does not require the open app conversation or browser pairing. Its model calls still need the RIFT service. Cloud remains a separate explicit mode.

## Verification

- Console TypeScript build: passed.
- Console tests: 39 passed, 0 failed, including scheduling, visible-history rendering, native cursor and tool details checks.
- Root `tsc --noEmit`: passed.
- Actual isolated PTY, 120×46, with welcome animation and deterministic 100-chunk streaming model fixture: idle key-to-paint median 2.02 ms, max 3.56 ms; typing during streaming median 1.52 ms, max 2.07 ms. The check waits for the typed text or cursor movement for a space, not just arbitrary stream output.
- Controlled long-history renderer benchmark: cold frame approximately 3.26 ms, median 0.039 ms, p95 0.464 ms after the fix. These numbers measure local rendering, not provider speed.
- Actual authenticated local CLI client using the UI preview model service: GPT-5.6 Sol, prompt `Reply exactly RIFT_OK. Do not use any tools.` Setup 300 ms; first assistant text 4.24 s; total 4.48 s; ready state, expected response, zero errors/approvals. This is a small connectivity smoke test, not a general coding benchmark.
- Installed `rift --version` from `/tmp`: 0.2.0. Doctor confirms local-tool-loop and no paired browser dependency.

Native Terminal UI access was denied by the computer-use tool, so verification used the provided video and separately launched test PTYs. Existing user terminal processes were not restarted. Exit an old CLI with `/quit`, then run `rift` to load the updated code. Public deployment of the preview-only model gateway remains separate.
