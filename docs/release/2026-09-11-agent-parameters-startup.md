# Agent parameters and startup evidence — 2026-09-11

## Reference and design

The actual macOS Cursor **Agents** window was exercised again. Its model trigger opens a compact parameter menu with context, effort and model. The IDE was not used. RIFT adopts the compact interaction and existing Graphite surfaces while retaining its own emblem, real model capabilities and approval controls.

Build now uses one model/effort trigger and one anchored popover. Model and effort views replace content inside that popover. Back and Escape return to the parameter overview; Escape from the overview closes and restores focus. Context capacity is informative, not an unsupported configurable setting. The existing effort slider/default reset remains available inside the same surface. Model-only and standalone effort APIs remain compatible with other callers.

Desktop rows stay compact; small screens and coarse pointers use 44px targets. Selected model navigation must reveal the option inside the panel without scrolling the surrounding chat. Draft text and Send/Stop remain visible under the existing constrained-height composer.

The production-component browser matrix passed all 70 cases across Chromium/WebKit, 360/390/430px mobile widths with fine/coarse pointers and desktop. It covers the shared parameter surface, model and effort changes, focus/dismissal, long drafts with/without a goal, and Send/Stop hit targets. A short-viewport keyboard case failed before panel-local reveal was added. Further diagnosis found WebKit's temporary scrollbar covering the right edge of an otherwise stationary model row for about 0.9 seconds. The model view now reserves scrollbar-side padding, and the follow-up check requires immediate five-point hit testing plus vertical containment rather than waiting for that scrollbar to fade. These are functional geometry checks, not comparative frame-rate measurements against Cursor.

Full integration verification also caught the slash-command contract affected by replacing the old dropdown. `/model` and `/reasoning` now send an acknowledged intent to the combined control, opening the requested view directly instead of toggling the surface or opening an intermediate screen. Legacy model-only/Studio controls keep their original activation path. Integration checks assert actual model choices/slider visibility and no chat submission, not a synthetic key-event count tied to the old implementation.

## Startup diagnosis and change

The worker records a bounded `startupTiming` object: handler entry, attempt start, allowlisted environment type and process uptime. The benchmark retains provider creation/start, attempt count and region without copying arbitrary task payload or metadata. Cross-runtime clock differences are explicitly labeled; these measurements do not isolate queue time or cold-start duration.

Two instrumented development jobs on worker `20260911.57` completed with first text at 10,662 and 12,630ms. Process age at handler entry was 834 and 657ms. The attempt-to-handler wall-clock deltas were 3,635 and 999ms.

MCP discovery previously loaded connection transports even when it returned a lazy registry. The transport import now occurs inside the settled connection attempt. The generated `agent-long` static import closure no longer includes 17 MCP client/SDK inputs (192,074 emitted bytes); the dynamic chunk remains available when a connection is needed. This is a module-graph result, not a measured runtime-byte or latency saving.

Three subsequent jobs on worker `20260911.58` completed with first text at 9,273, 10,000 and 9,253ms. All five jobs produced the expected final sentinel and no observed duplicate events or tools. The samples are too small and variable to establish a causal latency improvement or production SLO. The under-four-second target remains unmet.

## Process reuse remains disabled

The [Trigger.dev dev documentation](https://trigger.dev/docs/how-it-works) explains that development tasks execute in separate local processes while scheduling is remote. The installed CLI supports process reuse, but RIFT's global Convex URL override currently relies on process isolation. Reusing it could route a later job without an override to the preceding job's deployment. Late asynchronous callbacks and other cached clients also need review before reuse is enabled. No reuse setting or authorization/moderation gate was changed.

## Mobile qualification

The mobile composer already computes to 16px at its default size because an existing touch-specific rule takes precedence. A separate problem was found: that rule also forced an explicit 18px body preference down to 16px. The two existing touch rules now use `max(16px, var(--rift-type-body, 16px))`, preserving the larger preference while retaining the mobile floor. Desktop density is unchanged.

The independent computed-style matrix passed 28 cases: Chromium/WebKit across mobile and desktop sizes/pointer modes with default 13px and custom 18px body preferences. Each case traverses ten presets in light/dark mode and checks the textarea, focused input and actual command-paint alignment. The failing 18px preference was reproduced before the fix; a default 13-to-16 correction is not claimed.

The native iOS simulator was opened, but its keyboard controls were disabled and keyboard events did not reach Safari. No actual Safari software-keyboard pass is claimed. Existing WebKit viewport tests do not replace physical-device or native keyboard testing. Full route-shell, question-dock and keyboard geometry still need combined validation.
