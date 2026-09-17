# Preserve reading position when streamed code completes

Baseline: `c923783`. Two distinct rendering transitions lost the reader's place.

The unfinished Markdown fence used a direct `CodeHighlight` component, while its
completed form switched to Streamdown's `Block`. The remount discarded local Wrap
state and the plain-code scroll anchor. A real Messages/useMessageScroll WebKit
fixture reproduced an 800px shift with 401 lines of source.

The block renderer now retains `CodeHighlight` for both forms of a standalone
unindented fence. The installed parser splits later prose into subsequent blocks,
so adding prose preserves the fence's identity. Mixed Markdown, indentation, CR
input and ambiguous fence information stay with the normal parser.

A separate 80-line supported-language case exposed the highlighter's pending
state: installed react-shiki 0.10.1 renders no code until its asynchronous result
arrives. Two observed frames removed a 3220px code area, clamping scrollTop from
10104 to 7905. Restoring the same final dimensions could not recover the reader's
position. RIFT now uses the package's public highlighting hook with the complete
plain source as its pending fallback. Source/language/theme identity prevents an
old asynchronous result replacing current content. Streaming and oversized code
still skip optional highlighting; Wrap, copy and full source remain available.

Verification uses actual Messages, MessageItem, useMessageScroll, installed
Streamdown and react-shiki in Chromium and WebKit. Four bounded desktop cases
cover 401-line plain and 80-line highlighted code: close the fence while still
streaming, append prose separately, then finish. All four pass, with no skips or
retries. The visible line's offset is unchanged at every phase; every captured
highlight frame retains positive code height and the source prefix. Exact final
source including its newline is checked. Full source and late-result lifetime
also have unit regressions.

The first small-code run lacked CodeHighlight's descendant Tailwind rules in the
isolated fixture. That style failure was a test-environment issue, corrected
before diagnosing the actual asynchronous collapse. It is not counted as a
production styling fix.

Raw browser evidence: `/tmp/rift-code-lifecycle-evidence/accepted4`; prior failures
and geometry diagnostics remain in sibling evidence folders. This is a concrete
reading-continuity fix, not a full mixed-media/real-dock performance test, physical
mobile test or measured Cursor/Claude frame-rate comparison.
