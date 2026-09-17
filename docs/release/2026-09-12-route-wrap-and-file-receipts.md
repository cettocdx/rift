# Route return, code wrapping and late file receipts

Baseline: `32af4cb`. Follow-up to completion rendering; these changes address
reading state and late delivery, not provider startup latency.

## Reproduced failures

The actual code component kept Wrap in component-local state. Leaving a chat
unmounts its transcript; returning restored the scroll anchor but reset Wrap.
An isolated real-component WebKit case retained all 401 source lines but changed
from `pre-wrap` to `pre`, moving source line 40 from a painted offset of about
40px to -759px. This was a rendering-state defect, not lost server output.

The real Messages/MessageItem unit case separately reproduced a saved file
receipt being ignored when text parts, status and existing metadata stayed the
same. The comparator now checks the immutable `fileDetails` reference, so later
names/URLs and removal update the row. Existing persisted-file precedence is
unchanged; this is not an end-to-end file permission/download certification.

Both live file metadata handling and retained event replay also used a
first-write-wins merge. A final same-ID receipt could not replace an earlier
name or storage locator, and duplicates within one incoming batch survived.
A shared latest-complete-entry merge now deduplicates by file ID and retains
first display order. Replacement drops obsolete optional storage fields;
unrelated messages are untouched. Ordered replay yields the same result as
live delivery. Persisted message details still take precedence over temporary
stream details; changing that authority policy is outside this patch.

## Wrap retention

The authenticated shell's existing bounded, memory-only per-chat view cache
now owns explicitly selected code presentation. Message/part identity,
Markdown block and language distinguish snippets. Exact source lineage permits
append-only streaming; replacement/truncation, other blocks, chats and provider
instances do not inherit a choice. Unscoped Markdown remains local. Each view
retains at most 64 choices and 262,144 source characters; oversized/evicted
choices may reset on return, but rendered source is never truncated. No DOM,
localStorage, disk transcript or global cross-account cache is added.

Wrap is applied synchronously before scroll restoration's layout observation.
Tests exercise actual CodeHighlight and production Markdown/scroll behavior.
They cover plain and highlighted long code and mobile/desktop browser engines.

## Verification scope

- Unit regressions: late saved-file arrival/correction/removal; ordered receipt
  correction/deduplication/replay; Wrap identity, lineage, bounds and remount.
- Route browser diagnostic:
  `pnpm exec playwright test --config e2e/mobile-fixture/playwright.code-wrap-route.config.ts`.
- Late file/usage browser diagnostic:
  `pnpm exec playwright test --config e2e/mobile-fixture/playwright.late-completion.config.ts`.
  Uses actual Messages, FilePartRenderer, image decode, composer and scroll
  hook with synthetic receipts. Tests both an anchored reader and bottom-follow
  while preserving full code and a draft at desktop and 360/390/430px widths.

Fixture APIs model event delivery and route unmounts; they do not contact a
provider, authenticate, drive a physical software keyboard or exercise native
Next route loading. Initial late-receipt fixture setup omitted `metadata.mode`
and therefore correctly had no agent completion row; that setup failure was
corrected, not reported as a production defect. Final counts/build/native
verification are recorded in the external release evidence report.

## Strengthened image receipt check

The initial 16 browser cases checked the corrected name, card count, decoded
image, full code, draft and scroll position, but did not assert the corrected
`img.src`. Adding that assertion exposed a separate defect on the committed
first patch: the final-frame label still displayed the draft-frame URL. The
new check is retained; the initial matrix must not be cited as proof that image
URLs refreshed correctly. The subsequent image-resolution fix and its separate
unit/browser/full-gate evidence are recorded in the external report.
