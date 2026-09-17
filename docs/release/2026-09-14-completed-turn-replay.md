# Completed new turn unexpectedly replayed

User recording: Screen Recording 2026-09-14 at 12.49.51.mov (23.77 seconds).
The recording shows a completed greeting followed by a new Working indicator.

Reproduced a matching race in `useAutoResume`: a new chat starts without
persisted history; its local reader enters submitted/streaming and completes.
History then arrives while the server's active producer pointer is still set.
The initial-attachment flag previously remained false when history was absent.
The hook therefore resumed a turn it had just consumed. Successful durable
replay clears the SDK's last assistant parts to avoid duplicate deltas, explaining
the disappearing/reappearing answer. This is a reader replay, not evidence of a
second model generation.

Fix: observing submitted or streaming consumes initial attachment for this
mounted hook immediately, independent of history arrival. Explicit wake and
connection-error recovery retain their existing path. Existing chats attached
in ready state still perform their initial resume.

The new regression failed before the fix (resume called once) and passes after
it (no resume). 16 tests passed across the hook, real AI SDK recovery integration,
and replay helper. TypeScript and scoped lint passed. This verifies the matching
race; it does not claim that every possible reconnect presentation issue is fixed.

Published to Preview 3020 as `.next-ui-release-1789379953512-pre-effects` after
production build passed and 328/328 claims were released with no mapped streams.
HTTP probe returned 200. Existing windows need a reload to receive the new client
bundle. No native binary was rebuilt; the shared web UI contains the fix.
