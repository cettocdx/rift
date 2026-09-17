# Worker authority and real transcript follow-up

## Scope and authority

This continues `2026-09-11-worker-scope-mobile-shell.md`. The earlier URL/client scope did not bind service credentials. Actual-scope offline tests reproduced a run retaining deployment A while using credentials from environment B. This was a reuse-readiness regression, not evidence of a production cross-user incident. Process reuse remains disabled.

Worker scope now captures the service key at entry; a captured missing key remains missing. Backend operations use the scoped accessor instead of module-import credentials or later environment values. Migrated paths include chat persistence, suspension checks, scheduled runs, claims, checkpoints, billing, approvals, skills, file storage and MCP. Required/optional credential semantics remain unchanged. No secret enters task payloads or diagnostics, and the shared accessor remains free of Node imports.

Returned run recorders capture both client and service key at creation, including invalid configuration, so lifecycle callbacks and queued flushes cannot write to another deployment. Recording remains best-effort. Direct start/finish helpers resolve the current scope. The worker passes the captured key to the tool factory.

Verification includes real AsyncLocalStorage with mocked Convex transport: interleaved claim reads, billing close invoked from another scope, MCP loaded after an environment switch, missing authority, scheduled admission/suspension checks, bound cleanup, recorder events/evidence/flush and invalid URL behavior. The four billing/claim/MCP tests and four recorder tests failed before their respective fixes. Existing caller tests preserve the actual accessor exports in partial mocks.

Remaining reuse prerequisites include provider/Redis configuration binding, telemetry destination isolation, signing and public URL capability guards, late callback and cancellation stress tests, and live deployment validation. No startup latency improvement is inferred from these correctness changes.

## Actual transcript anchoring

The browser fixture now imports the actual Messages, MessageItem, AssistantTranscript, FilePartRenderer and useMessageScroll path, with isolated services. It uses real paragraph layout, content visibility, a local generated-image fixture, the actual mobile question/composer shell and panel-width changes.

When a keyboard-sized layout plus question dock reduced the transcript to zero height, captureAnchor discarded the previously visible paragraph. Hidden width changes reflowed that paragraph; after reopening, its position drifted by 198px in a WebKit 390px reproduction. The minimal fix retains the existing semantic anchor while the scroll area has zero height. No new scrolling layer, timer or global animation is introduced.

A synthetic prepend test also caused remounts through changed part indexes. It is not used as evidence of a production stream bug: the acceptance test uses the actual append-file behavior, which renders the new image above prose while retaining existing part identity. Evidence preserves the exploratory failure separately.

This remains an offline browser harness, not a physical iPhone software-keyboard test or an authenticated production performance comparison.

## Cursor Agents reference

Cursor's desktop Agents interface was used directly again, without opening IDE. The observed composer uses one model/effort summary; its parameter menu exposes thinking, context and effort, with a compact secondary list and a checkmark on the selected effort. Neutral surfaces, subtle separators and one clear selection state are reference details. Escape closes the submenu and returns to the composer. The reference screenshot is retained in the external evidence bundle.

These interactions guide RIFT's existing consolidated parameters and further UX work. They do not establish access to Cursor's private harness, equal task speed or full interaction parity. No external model task was submitted during this inspection.

## Verification checkpoint

- Root backend/recorder/scope suites: 147 tests passed across 15 suites.
- Migrated authority callers: 332 tests passed across 24 suites (includes four original RED cases).
- Actual transcript browser matrix: 28 passed, four explicitly inapplicable desktop cases skipped, zero failures/flaky tests; Chromium and WebKit, mobile widths 360/390/430 plus desktop, 56.3 seconds.
- In the WebKit 390px reproduction, the heading offset now remains 0.34375px → 0.34375px after hidden reflow; the previous run was 0.34375px → 198.34375px. Scroll top adjusts 439px → 637px to preserve the paragraph.
- Twelve scroll-hook unit tests passed; TypeScript and scoped lint passed.
- Full release gates and native served-build verification are recorded in the external progress report after completion; these focused results alone do not establish production readiness.
