# Saved preview recovery audit

Observed in RIFT UI Preview: the Rota chat `daf3b219-949c-4b8d-bc88-c4f9a04fde1a` opens a historical E2B URL displaying “Sandbox Not Found”. This is not a scroll/layout failure.

## Current gaps

- `app/components/Chat.tsx` restores historical expose-preview URLs without a current availability check.
- `BuildPreviewPanel`/`ExposePreviewCard` describe historical evidence as live/available. Generic browser iframe load completion does not establish application health.
- No source snapshot/restore facility was found in the inspected project/sandbox/publish paths. Do not claim deletion recovery without surviving files or repository evidence.
- `ensureSandboxConnection` can kill incompatible/broken environments and create replacements. It is unsuitable for read-only preview health checks.
- `app/api/publish/route.ts` uses the user-wide namespace instead of resolving the chat/project runtime. Publishing is not a recovery mechanism; audit its binding before relying on it for project publication.

## Required implementation

1. Authenticate a chat-ID-based status endpoint, load owned chat and persisted preview identity, resolve canonical project/chat namespace.
2. Use exact owner-bound sandbox lookup/connect only; never create or kill during health inspection. Distinguish transient check failure from confirmed missing environment.
3. Verify persisted port inside the owned sandbox with bounded localhost checks, deriving URLs through SDK getHost. Never fetch arbitrary supplied URLs server-side.
4. Offer an explicit recovery request that inspects surviving files/connected repository, starts the application, and verifies it. A blank replacement is not restoration.
5. Fence async results by chat and preview identity; discard stale completions after navigation.

## Acceptance still missing

Expired saved previews; foreign chat and namespace rejection; no create/kill during checks; paused environment behavior; transient failure vs deletion; stopped dev server; stale results after chat switch; provider error page never marked healthy. The current desktop observation proves the failure, not recovery.
