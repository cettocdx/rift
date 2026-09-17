# Isolated native render diagnostic fixture

Run `RIFT_RENDER_FIXTURE=1 node e2e/mobile-fixture/server.cjs` from the repository root. Open `http://127.0.0.1:3038/` (redirects to `/c/chat-0?theme=dark`); use `?theme=light` for light appearance. The port is shared with the other standalone mobile/sidebar fixtures; run one at a time.

This is **not a production route** and does not change DevLabGate. It never starts Next, auth, Convex, workers, terminal sessions or tasks, nor reads .env. HTTP binds loopback; CSP denies connection and frame requests. Native host testing requires a separately isolated debug application with no IPC capabilities; do not load user content into it.

## Authentic components and explicit limits

Imports actual SidebarHistory → SidebarConversation → ChatItem, useWorkbenchDock/dockReducer, WorkbenchDock, AgentActivityPanel, LiveSidebarContentProvider, and production CSS. The outer tool-pane wrapper copies the production right-pane contract from chat.tsx, including `.container`, `data-visible`, inert/aria-hidden and width. That outer node owns the normal `dockReveal` opacity animation.

All chats are synthetic. Global state and Next pathname/router are local adapters; unrelated Files/Preview/Browser/Detail service panels are disabled. Desktop workspace grants are empty; mutation hooks throw. The price formatter is replaced with 'Offline' to avoid the model-price → token-bucket server dependency. This does not test those disabled surfaces, actual Next routing, authenticated app state, native IPC, or production bundle startup. React runs under the existing fixture's NODE_ENV=test bundling contract.

## Workflow

1. Select Conversation 1, then Conversation 2; inspect both sidebar selection and current pathname.
2. Open Activity, hide with the actual dock button, then open it again.
3. Click **Read render diagnostics** when the paint differs from expected.
4. Read the visible JSON: pane/dock/active tab/body, actual content-visibility row wrapper, active row and all ten rows. It reports computed styles, geometry, active/inert/hidden attributes and direct-node animation currentTime/playState/pending/timing.

Reading does not alter styles, finish/cancel animations, remount the dock or capture user text. The visible result itself causes its own small React update; getComputedStyle/getBoundingClientRect may cause the browser to flush style/layout. The snapshot is not a compositor dump or proof that those pixels painted. Keep normal animations enabled and compare native screenshots with DOM diagnostics.

Tests: `pnpm exec playwright test -c e2e/mobile-fixture/playwright.render.config.ts`. Chromium/WebKit × light/dark cover real panel visibility, route/selection updates, read-only snapshots, normal animation rules, show/hide/reopen, and no external/service requests. Screenshots explicitly allow animations. No native bug fix is claimed.
