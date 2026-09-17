# Working on an original computer file

The composer now uses **Open file**. In RIFT Desktop this opens the system file picker directly, then displays the selected filename. The agent reads and edits that original file through a narrowly scoped native grant. The existing + attachment action remains separate.

## Interaction changes

| Before | After | Reason |
| --- | --- | --- |
| Files suggested a browser or uploaded context | Open file launches the native picker directly | The action matches working on an original file |
| Shared files could be discovered outside their intended chat | Each request binds one opaque file grant to its chat | Another chat cannot discover or use the selected file |
| A connection could appear ready before subscribing | Ready follows the live relay subscription | A message cannot dispatch while file access is unavailable |
| A failed preflight could discard typed text | Failed preflight preserves the draft and blocks duplicate submissions | The user can reconnect and retry without losing work |
| Native writes were absent from the changes summary | Edited files includes the original/modified diff | The actual edit can be reviewed in the conversation |

The control uses the existing system font, neutral hover and keyboard focus, compact outline icons, reduced-motion support, a named close button, and explicit connection/reselection status. Closing the file revokes this chat's grant and returns focus to Open file. Cancelling the picker keeps the previous selection.

## File access contract

- Desktop text/code files, UTF-8, at most 256 KiB. Binary documents and larger files are rejected with a message.
- The native implementation supports macOS and Linux. Other platforms fail closed for this new file-only grant.
- The browser does not claim it can overwrite a local original. Its guidance points to Desktop; + can still attach a copy.
- The native grant exposes a basename and opaque ID, not an absolute host path. It does not grant a folder, siblings, terminal, or loopback-network access.
- Reads return a version hash. A write must carry that version and fails on a detected external edit. Replacement is atomic and retains file metadata. This is optimistic concurrency, not an OS-wide transaction against every external writer.
- Plan mode remains read-only; the existing approval policy still applies. Provider/model changes keep the same file context and tool boundary.
- Failed, denied, pending, or unmatched reads/writes do not invent a diff. Unknown before-content is explicitly marked unavailable.

## Verification

- 278 JavaScript/TypeScript tests passed across 21 focused suites. One invocation included a mistaken .ts test path; the actual .tsx activity suite was subsequently run and all 20 tests passed.
- 15 native access tests passed, including path isolation, stale versions, permission preservation, and folder-grant compatibility.
- TypeScript check, targeted ESLint, and git diff whitespace check passed.
- Actual RIFT UI Preview native picker → live agent read → original-file write → verification read completed successfully on a synthetic fixture. Only `status: before` changed to `status: after`; `keep: unchanged` was preserved. The UI displayed **Edited 1 file, +1 −1** and the Review panel showed the corresponding diff.
- Connection readiness was rechecked after restarting the local relay with persisted signing configuration. The synthetic file grant was closed afterward and focus returned to Open file.

Evidence: `working-file-desktop-smoke.json` and `desktop-relay-live.json` in this directory.

## Local preview setup

The preview uses localhost:3020 and a loopback-only Centrifugo relay on 127.0.0.1:8000. Its private configuration/signing environment and development rollback are stored outside the repository with restrictive permissions under `~/.local/share/rift-ui-preview/centrifugo/`. Docker must be running. The container uses `unless-stopped`; the development Convex endpoint and worker use the same local relay/signing configuration. Production settings and the installed production RIFT application were not changed.

## Skills applied

`systematic-debugging` for reproducing the connection and draft-loss faults; `emil-design-eng` for restrained control styling and motion; `accessibility` for keyboard focus, semantics and visible status; `verification-before-completion` for native and automated checks.
