# RIFT Phase 1 — implementation map

Derived from the Phase 0 audit against
`RIFT_UI_UX_MASTER_REDESIGN_AND_IMPLEMENTATION.md`. Every item below was found by reading the
code; each carries the file and line it was found at. Items are ordered by what a user feels
first, not by how the audit grouped them.

Status legend: `[ ]` open · `[x]` done · `[~]` partially done

---

## A. Stop and cancellation

The whole area shares one root: `ChatStatus` is
`"submitted" | "streaming" | "ready" | "error"` (`types/chat.ts:937`). There is no
`stopping` and no `cancelled`, so nothing downstream can render either.

- [x] **A1. A stopped run is reported to the user as a product failure.**
      `lib/chat/interrupted-response.ts:35-49` returns true whenever the last visible message
      is a user message and no stream is active, which is exactly the state a user's own Stop
      produces. The banner reads "RIFT stopped before it could finish this response."
- [x] **A2. Screen readers are told the response completed, on Stop.**
      `AssistantCompletionAnnouncer` announces "RIFT response complete." on the transition to
      `status === "ready"`, which Stop also produces.
- [x] **A3. Hack Workbench Stop never reaches the server.**
      `app/components/HackerMode.tsx:2041, 2083, 2698, 2921` all call the client `stop` from
      `useChat` and nothing else. The security operation keeps running server-side.
- [x] **A4. `stop-and-send` drops the user's message when cancel fails.**
      `app/hooks/useChatHandlers.ts:378` awaits `stopActiveStream()` outside the `try` that
      begins at line 412.
- [x] **A5. Cancel failures are swallowed.**
      `app/hooks/useChatHandlers.ts:174-193` throws on `!response.ok`; the throw is caught at
      470-471 into `console.error`. `{canceled:false, reason:"no_active_run"}` returns HTTP 200
      (`app/api/agent-long/cancel/route.ts:121-125, 165-168`) and the client discards it.
- [x] **A6. Cancelled terminal evidence is fabricated.**
      `lib/utils/message-processor.ts:212-248` rewrites a killed command as `output-available`
      with a synthetic exit code 130 and no timing.
- [x] **A7. No durable cancelled state.** `canceled_at` is written by
      `convex/chatStreams.ts:123-130` and cleared by both completion paths, so a stopped run
      is indistinguishable from a finished one after the fact.

## B. Controls that assert what they do not know

- [x] **B1. Every finished terminal command renders "Done", including failures.**
      `app/components/tools/TerminalToolHandler.tsx:192-215` maps `output-available` to
      `status="done"` with no branch on the exit code that is already on the payload.
- [x] **B2. Hack Workbench asserts AUTHORIZED and 100% toolchain from string literals.**
      `app/components/HackerMode.tsx:2069, 2356` — the scope banner renders even with no
      target set.
- [x] **B3. The Plugins "Connected" filter does not filter on connection state.**
      `app/components/McpMarketplace.tsx:144, 548` — rows whose own badge reads "Needs
      attention" are listed under Connected.

## C. Duplicate sources of truth

- [x] **C1. GitHub and Stripe connect buttons cannot succeed.**
      `app/components/mcpCatalog.tsx:195, 231` declare `auth: "oauth"`;
      `lib/ai/mcp/mcp-oauth-catalog.ts:29-33, 49-53` record `oauth: false`. This is the same
      pair that logs `mcp_connection_failed` on every production run.
- [x] **C2. The free daily Ask allowance has three values on three surfaces.**
      Enforced: `lib/rate-limit/free-config.ts:27` (3). Advertised: `lib/pricing/plans.ts:49`
      and the landing copy differ.
- [x] **C3. Four Build models are missing from the billing price table** and fall through to
      a generic rate (`types/chat.ts:393-568` vs the price table).
- [x] **C4. "Is this plugin usable" is answered differently by the composer and the runtime.**
      `app/components/ChatInput/ComposerPalette.tsx:392-394` requires
      `connectionStatus === "verified"`; the agent runtime does not.

## D. Route and overlay state

- [x] **D1. No overlay closes on navigation.** There is no route→overlay teardown anywhere.
- [x] **D2. The sidebar's More fold hides the current route.** `SidebarHeader.tsx:49-81` — the
      fold defaults closed and never opens for the active destination, so a user on /tasks
      sees nothing selected.
- [x] **D3. The agent-activity pane is global and never cleared by route change**, so one
      conversation's tool output renders inside another (`app/contexts/GlobalState.tsx:247-250`).

## E. Run and evidence model — the structural work

These are the spec's §20 requirements. They are larger than the items above and depend on a
schema change, so they come after A–D.

- [x] **E1. There is no Run entity and no RunEvent log.** `convex/schema.ts` has no `runs`,
      `run_events` or `evidence` table; a chat message row is the only durable object.
- [x] **E2. Message persistence is write-once** — `convex/messages.ts:410-473` never updates
      `parts` on an existing row.
- [x] **E3. Cancelled partial output survives only if a fire-and-forget client mutation lands**
      (`trigger/agent-long.ts:1879-1882`).
- [x] **E4. Compaction destroys evidence in place** rather than offloading it
      (`lib/chat/compaction/prune-tool-outputs.ts:238-276`), and cannot shrink `data-terminal`
      parts at all, so messages still approach Convex's 1 MiB cap.
- [x] **E5. Terminal commands persist no start time, end time, duration or working directory.**
- [x] **E6. `report_finding` records nothing durable** and its `evidence` field is optional
      free text (`lib/ai/tools/report-finding.ts:40-45`), so no Hack finding links to a command.

---

## Not Phase 1

Everything in spec sections 8–19 that is presentation: page redesigns, the inspector layout,
the model picker, Studio controls, the landing page. The spec is explicit that Phase 4
cosmetic expansion does not begin while Phase 1 trust failures remain.
