# Long-message storage recovery — 2026-09-10

## Implemented
- Inline storage budget now reserves space for duplicated searchable text and metadata (400 KiB parts budget).
- Emergency overflow handling covers raw string tool outputs, protected/metadata-heavy parts and oversized prose. Normal messages stay unchanged.
- Before any compacted assistant message is committed, the complete sanitized original is stored as a downloadable JSON file through the existing authenticated upload path. Upload failure prevents committing placeholders.
- Original generated-file references are retained for ownership/attachment protection.
- Archives remain attached for download but are excluded from automatic file-context token accounting and model-file processing.
- Premature provider stream termination now offers the existing inspect-and-continue flow instead of displaying raw JSON and blindly retrying.

## Verification
- Two overflow regression tests failed before the fix; passed after.
- Combined storage/model-boundary/UI/reconnect/checkpoint suites: 143 tests passed. Additional save-order fault test passed (five tests in its suite; overlapping suites are not additive).
- Actual 1,380,268-byte original uploaded and downloaded; SHA-256 matched. Compacted chat message and archive attachment saved and read back successfully. See live.json.
- Production build and targeted lint passed. Local production frontend restarted, HTTP 200.
- WebKit synthetic 200-row, 600-update code replay: p95 21 ms, p99 23 ms, max 40 ms; zero frames over 50 ms, draft retained. Not a whole-app or competitor parity claim.

## Limits
This prevents the reproduced document-size failure by offloading content; it does not guarantee network/provider/storage availability. If archive storage itself fails, the save fails visibly rather than discarding the original. Full automatic recovery across arbitrary side effects and machine death remains outside these tests. An already-running old worker is not rewritten in place. First-token latency was not improved or rebenchmarked in this change. Earlier media/panel fixture recorded 0 px drift; it was not rerun here.

## Follow-up: evidence UTF-8 overflow
- Found a separate inline evidence cap that measured bytes but sliced UTF-16 characters. Multibyte output could still exceed Convex's document limit.
- The cap now includes its truncation notice in the 600 KiB byte budget and omits incomplete trailing UTF-8 code points.
- Regression failed before the change (1,382,443 stored bytes), then all 17 run/evidence tests passed. Root TypeScript and targeted lint checks passed.
- Live before/after used the same 1,440,000-byte input: before, `recordEvidence` failed with `1.32 MiB > maximum size 1 MiB`; after deployment, the mutation successfully persisted the excerpt. See evidence-live.json. This verifies persistence, not a full archive round-trip for standalone evidence.
- Convex deployment completed at 17:34 Istanbul. CLI telemetry hit a separate Sentry TLS/network error; CI mode avoided optional telemetry without weakening certificate validation. The CLI's separate typecheck was disabled because this repo has no convex/tsconfig.json; root `tsc --noEmit` was run instead.
- No model calls or user tasks were started by this evidence probe. No new whole-app latency or scrolling claim is made in this follow-up.
