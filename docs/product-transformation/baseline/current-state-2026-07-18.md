# RIFT transformation baseline — 2026-07-18

This document freezes the observable state of the live application at
`http://localhost:3014` before product transformation work. It is paired with
the checkpoint commit `c0d1eef` on branch `rift-transformation` and the runtime
captures under `artifacts/runtime-baseline/2026-07-18/`.

## Repository and runtime identity

- Live source: `/Users/cetto/Developer/rift-cursor`
- Framework: Next.js 16.2.6, React 19.2.6, TypeScript 6, Tailwind 4, Convex,
  AI SDK, xterm, optional local PTY bridge, and a Tauri desktop package.
- Live command: `pnpm dev:cursor`, serving the Cursor-skinned product on port
  3014 with the local terminal/workspace bridge enabled.
- Clean-source checkpoint: `c0d1eef checkpoint: live Rift baseline before
autonomous transformation`.

## Protected HackWorkbench contract

The canonical HackWorkbench is `/hack`, implemented by
`app/hack/page.tsx` and the self-contained `app/components/HackerMode.tsx`,
with the dedicated `/api/hack-chat` transport. Its current pixels and behavior
are a hard regression boundary.

Do not alter these surfaces as part of the broader product redesign:

- `app/hack/page.tsx`
- `app/components/HackerMode.tsx`
- `/api/hack-chat`, security branches in the shared chat handler, or stream
  reconnect behavior
- Hack chat/message/file persistence or premium-purpose enforcement

Shared dependencies used by Hack are protected by regression: global and data
stream state, file upload/view/render paths, markdown/code rendering, Tauri
file helpers, Convex chat/message/file records, and model/tool/sandbox
streaming.

Any later change in those shared paths must prove auth/premium/session routing,
history hydration, active-stream reconnect, task and free-form launch, file
attach/remove/view/download, reasoning/tool streaming and stop, evidence and
finding extraction, report/export/print, keyboard behavior, responsiveness,
and screenshot parity.

## Runtime evidence

An authenticated, read-only browser pass at 1360 x 758 verified `/`, `/hack`,
`/workspace`, `/tasks`, `/plugins`, `/artifacts`, `/studio`, `/pricing`, and
`/download`.

- Every visited route rendered non-blank.
- No browser console warnings/errors, visible Next.js error overlays, or failed
  resources were captured.
- Hack redirected to its UUID-backed session, reported Ready, and its task
  drawer exposed all 50 capabilities without starting an assessment.
- CLI Workspace moved from Connecting to Connected in about eight seconds;
  Explorer and the PTY populated. The terminal showed unusual visible `192%`
  prompt text, retained as a follow-up diagnostic.
- Tasks showed a real empty state with zero tasks/runs.
- Plugins showed six configured connections; Stripe and GitHub visibly needed
  attention.
- Artifacts showed three generated items and Studio selected Seedance 2.0.
- Anonymous probes correctly redirected protected `/hack` and `/workspace`
  routes to login; referenced installer assets responded successfully to HEAD.

The pass deliberately sent no prompt, launched no scan, ran no terminal
command, and mutated no task, plugin, artifact, or private data. Detailed route
results and all screenshots live in
`artifacts/runtime-baseline/2026-07-18/README.md`.

## Engineering gates

| Gate                        | Baseline result                    | Important scope limit                                                                                                   |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`            | Passed in 8.60 s                   | Root tsconfig excludes tests and `__tests__`.                                                                           |
| `pnpm lint`                 | Passed in 31.16 s, zero findings   | Script omits several production trees including `components`, `convex`, `packages`, and e2e.                            |
| Representative Jest slice   | 26/26 suites, 111/111 tests passed | Shell, agents, workbench, workspace, MCP credential vault, and error redaction; 229 candidate test files exist overall. |
| Local bridge `tsc --noEmit` | Passed in 2.23 s                   | Package-level check.                                                                                                    |
| Desktop `tsc --noEmit`      | Failed with TS18003                | `packages/desktop/tsconfig.json` includes `src/**/*`, but that package has no TypeScript inputs or quality scripts.     |

No secret-shaped literal, tracked real environment file, or client-side server
secret reference was found. MCP credentials use the existing server-only
AES-256-GCM vault, authenticated persistence, no-store responses, and redaction
tests.

## Product anatomy at baseline

- The root Build route is a sparse empty composer, not yet a useful command
  center.
- `/workspace` is a separate, real IDE surface with Explorer, editor, changes,
  terminal, Git, and agent activity. It is outside the HackWorkbench freeze.
- Tasks, plugins/MCP/skills, artifacts, and generation are backed by existing
  application and Convex flows.
- The six-pet agent crew is real but buried in Settings. It persists as the
  managed `rift-agent-roster` skill and is injected into runtime instructions;
  there is no first-class Agents route, broad roster, or team-management
  surface.
- Settings currently exposes Personalization, Data controls, Agents, API Keys,
  Remote Control, and Account, but not a searchable editor-class control
  center.

## Confirmed integrity gaps

1. Branding is contradictory. The exact canonical logo is the two-path mark in
   the HackWorkbench header; shared components and metadata currently call a
   pixel panda canonical. The byte-identical `app/icon.png` and
   `public/icon-512x512.png` rasterize the actual blue/white mark.
2. Shipped marketing code includes fabricated terminal/build transcripts and
   noninteractive UI previews that appear functional.
3. Shared-chat fork state can expose an enabled Stop generation button wired to
   a no-op.
4. Green type/lint results cover less of the repository than their names imply.
5. The desktop package quality check has no TypeScript input and no dedicated
   lint/test scripts.
6. The root Home experience, first-class agent orchestration, and unified
   settings/navigation remain the highest-value product gaps.

## Transformation guardrails

- Preserve HackWorkbench exactly and compare against `02-hack-workbench.jpg`
  and `03-hack-workbench-tasks-open.jpg` after shared changes.
- Reuse real application queries, mutations, routes, sandbox state, and agent
  runtime configuration. Do not invent metrics, integrations, terminal output,
  logs, or inactive controls.
- Keep the existing dense, restrained desktop workbench language: semantic
  tokens, native-feeling typography, compact hierarchy, keyboard access,
  explicit loading/empty/error/success states, and reduced-motion support.
- Treat current official product research in
  `docs/product-transformation/reference-research-2026-07-18.md` as directional
  evidence, not a visual template to copy.
