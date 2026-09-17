# Desktop readiness and command discovery

Investigated the two failed operations shown in the marketing conversation. Read the persisted checkpoint without replaying any command or modifying the active run.

## Evidence

- The alleged file read was actually `desktop_access_status`, with `{ok:false, code:"unavailable"}`. The transcript classifier mapped it to file reading; MessagePartHandler had no renderer, so expanding the group did not show this result.
- `pwd && ls -la && command -v ffmpeg && command -v python3` exited 1 after listing the directory. FFmpeg was unavailable, which short-circuited the Python check. The tool description encouraged `&&` without distinguishing prerequisites from optional availability checks.
- Subsequent recorded commands found Python, installed FFmpeg successfully, inspected two 8-second 1920×1080 video outputs, and continued the task. The initial command failure is historical evidence, not proof the whole run stopped.

## Changes

- Desktop readiness has its own category/icon. Known unavailable/denied readiness results show `needs-setup`, with an explicit setup message. Unknown probe errors and actual failed desktop actions retain failure semantics. No permissions are granted or bypassed.
- Added a renderer for the desktop status result so users can see its reason and understand cloud work may continue.
- Terminal tool guidance now distinguishes dependent commands from independent availability checks. It provides a POSIX shell probe that reports each missing tool without skipping later checks. Actual build/test/generation failures must not be suppressed.
- Existing failed command records remain unchanged. UI now distinguishes `1 failed` from `desktop setup needed` rather than claiming two execution failures.

## Validation and limits

- Two regression tests failed before the classifier change; all 121 tests across transcript, desktop result, activity and terminal suites then passed.
- TypeScript `tsc --noEmit` passed.
- Live 3020 conversation displayed the corrected summary and desktop result details.
- POSIX shell probe tested with one intentionally absent command followed by `sh`: reported both missing and available, exit 0.
- No model run restarted, cloud commands replayed, desktop permission enabled, or historical record rewritten. The currently active run retains its existing prompt; updated tool guidance applies when a new tool set is constructed. This does not establish that all future external operations are error-free.
