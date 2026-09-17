# RIFT performance budgets — 2026-07-18

These budgets are the release contract for the Cursor-class product surface.
They separate interaction targets that must be profiled in a production build
from hard limits already enforced by the runtime.

## Interaction targets

| Journey                         |                                                    Budget | Verification signal                                                      |
| ------------------------------- | --------------------------------------------------------: | ------------------------------------------------------------------------ |
| Composer typing                 |                            p95 input-to-paint under 50 ms | no network/query work on keystroke; test in a 200-message thread         |
| Panel resize                    |                      p95 frame under 20 ms while dragging | no visible jump; keyboard resize remains immediate                       |
| Warm authenticated route change |    content-ready under 500 ms on a local production build | shell remains mounted; no duplicate stable-data reload                   |
| Terminal echo                   |                visible within 100 ms of a local PTY event | input lease and SSE stream stay connected                                |
| Long transcript append          |                 p95 commit under 50 ms at 200 loaded rows | historical rows remain memoized; offscreen rows use `content-visibility` |
| Editor tab switch               | p95 under 100 ms for files at or below the editable limit | Monaco model reused while open and disposed after close                  |

Development-server compile time, first Convex authentication, and first PTY
startup are deliberately excluded from warm interaction numbers. They are
reported separately when profiling so a hot-reload build cannot masquerade as
production runtime cost.

## Enforced resource budgets

| Resource                        |                                      Enforced limit |
| ------------------------------- | --------------------------------------------------: |
| Initial conversation page       |                                         14 messages |
| Conversation history page       |                                         28 messages |
| Editable Workbench file         |                                               1 MiB |
| Persisted Workbench draft       | 20 docs, 1,000,000 characters each, 3,000,000 total |
| Persisted terminal scrollback   |                                128 KiB per snapshot |
| Manual terminal output          |                                     128 KiB per run |
| Git status surface              |                                           500 files |
| Full command-output accumulator |                                               5 MiB |
| Manual terminal execution       |                                          20 seconds |
| Interactive terminal request    |                                          12 seconds |
| MCP connection                  |                                          12 seconds |
| MCP call                        |                                          90 seconds |

## Rendering and lifecycle rules

- Heavy Monaco code is dynamically loaded only when the Workbench editor is
  rendered. Closed Workbench models are disposed, and all owned models are
  disposed on workspace teardown.
- Historical message rows receive stable positional flags rather than changing
  array indexes and lengths. Offscreen message content uses intrinsic sizing
  plus `content-visibility: auto`.
- Git change rows use the same offscreen rendering strategy. Chat history and
  search results remain paginated rather than rendering an unbounded result.
- Terminal output, drafts, editable files, Git records, MCP calls, uploads, and
  generated media all have explicit byte, count, or timeout ceilings.
- Temporary viewport overrides, PTY/SSE listeners, object URLs, Monaco models,
  and browser tabs must be released at the end of their owning lifecycle.

## Repeatable automated evidence

The following invariant suite is safe to run in CI and does not depend on
wall-clock timing:

```sh
pnpm exec jest --ci --runInBand \
  app/contexts/__tests__/InputContext.performance.test.tsx \
  app/components/__tests__/Messages.performance.test.ts \
  app/components/workbench/__tests__/workbench-performance-budgets.test.ts \
  app/components/workbench/__tests__/WorkbenchEditor.models.test.ts \
  app/components/pro/__tests__/useResizableSplit.test.tsx
```

It verifies that composer updates do not re-render a 200-row transcript or
API-only consumers, a turn append keeps 199 historical position props stable,
a 28-row history prepend preserves every loaded row key and position prop,
resize pointer moves coalesce to one animation-frame update, closed Monaco
models are disposed, PTY scrollback stays at 128 KiB, and Workbench drafts obey
their document-count and character budgets.

These deterministic checks validate the architecture and hard caps; they do
not substitute for input-to-paint, commit-time, or terminal-echo traces. The
p95 interaction targets above remain production-profile release criteria and
must not be reported as measured until that profile is captured.

## Production sample — 2026-07-18

An authenticated local production build was started from the warning-free
`.next-cursor-build` output and profiled through the same semantic navigation
controls used in the browser verification pass.

| Sample                         | Content-ready time |
| ------------------------------ | -----------------: |
| `/` to `/agents` (warm)        |              87 ms |
| `/agents` to `/` (warm)        |              74 ms |
| `/` to `/agents` (warm repeat) |              46 ms |

All three samples met the 500 ms warm-route budget. A page-side readiness
watcher ran concurrently with the unique accessible navigation action and
stopped when the destination heading or composer was present. The first cold
route load was deliberately excluded, as specified above. The production
server itself reported ready in 179 ms.

The same pass found zero warning/error console entries, zero horizontal
overflow, and the expected planar Home geometry. It also confirmed that the
local PTY reached `Connected` and populated the Explorer. These are release
samples rather than a statistically meaningful p95 profile; composer paint,
resize frames, terminal echo, transcript commit, and editor-switch p95 still
require a dedicated browser performance trace.

Production output tracing was also corrected: the interactive-terminal route
NFT fell from 4,867 files to 450 files, and repository source files in that
trace fell from 4,417 to zero. The post-fix 56-page build completed without the
previous Turbopack unexpected-file warning.

## Release gate

A release fails this contract if a representative production profile exceeds
an interaction target twice in three runs, if a hard limit is removed without
a documented replacement, or if a long-thread/terminal/editor test shows
unbounded retained work. Bundle size must be compared against the previous
production artifact; a route-level compressed JavaScript increase above 10%
requires an explicit review and a lazy-loading decision.
