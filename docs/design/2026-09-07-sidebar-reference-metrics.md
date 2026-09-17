# Sidebar reference measurements — 7 September 2026

User direction: use the running Cursor desktop sidebar's typography and spacing,
keep Build's cube, and preserve the requested 16px unfilled navigation icons.

## Live reference, measured through Cursor DevTools

The active Cursor Agents window renders `ui-sidebar-menu-button-label` and
`ui-text` components. Its older `agent-sidebar-cell` rules are not used here.
Reading those old rules led to the incorrect 12px/400 implementation; the table
below supersedes that earlier measurement.

| Role                   | Font size | Weight | Line height | Letter spacing |
| ---------------------- | --------- | ------ | ----------- | -------------- |
| New Chat / Search      | 13px      | 418    | 18px        | -0.08px        |
| Conversation title     | 13px      | 418    | 18px        | -0.08px        |
| Conversation timestamp | 13px      | 418    | 18px        | -0.08px        |
| Account name           | 13px      | 418    | 18px        | -0.08px        |
| Repositories heading   | 12px      | 418    | 16px        | normal         |

Computed family: `-apple-system, BlinkMacSystemFont, sans-serif` (Chromium serializes
BlinkMacSystemFont as `system-ui`). Computed smoothing is `antialiased`, optical
sizing `auto`, font features and variations `normal`. Live window zoom factor is 1.
The apparent weight difference was not a smoothing difference: the live normal
weight token resolves to 418 instead of its stylesheet fallback of 400.

Live geometry in CSS pixels:

- Row box: x=8, height=30; successive row starts differ by 31.
- Navigation and conversation labels start at x=38.
- Section header box: height=32; label starts at x=14.
- Last navigation row ends 13px before the section header box.
- Cursor's first row starts at y=43. Rift keeps its native window strip clear and
  starts at y=45; this is separate from the matched row typography and spacing.

Only DOM and computed styles were read. Cursor DevTools was closed and its dock
position restored afterward. Cursor settings and zoom were not changed.

## Rift implementation and verification

Sidebar-scoped system font and weight 418, 13/18 navigation/history/account rows,
12/16 section labels, -0.08px row tracking, 30px rows with a 1px gap, and an 8px
outer inset. A fixed empty status-icon slot keeps all conversation titles aligned
at the same 38px as navigation labels. Appearance text-size preferences continue
to scale the role sizes. Rift-specific membership text uses the smaller label role.

Browser computed styles verified the live reference's font, weight, line height,
tracking, row height and horizontal label alignment. Native Rift was also checked
visually. Platform title-bar geometry and renderer-specific rasterization are not
claimed to be pixel-identical.

Shared Phosphor regular-outline icons remain 16px: paper plane, existing cube,
film slate, shield, puzzle piece, robot, history clock, checklist, stacked layers,
folder, gear, magnifier, and outline ellipsis. These are Phosphor glyphs, not an
extraction of Cursor/Claude's proprietary icon font.
