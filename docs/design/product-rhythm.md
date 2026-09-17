# Product typography and spacing

The product uses the selected appearance font (`--font-cursor-ui`) and scales
semantic type roles from `--rift-ui-font-size`. Do not introduce a fixed font
size for a new control. Code, terminal output and media retain their own scales.

| Role | Default | Weight | Use |
| --- | --- | --- | --- |
| Caption | 11px | 400 | Counts, timestamps, identifiers |
| Label | 12px | 400 or 500 | Descriptions or group labels |
| Body / navigation | 13px | 400 / 500 | Controls, names, UI text |
| Section | 14px | 500 | Section, card and dialog headings |
| Message | 14px | 400 | Conversation reading text |
| Page title | 18px | 500 | Page heading and primary identity |

Use `text-ui*`, `rift-page-title`, `rift-page-description`, and
`rift-section-title`. Supporting prose uses 1.5 line height; chat uses 1.6.
Do not flatten headings and explanations into the same weight.

Utility page frames use `rift-page-frame` and `rift-page-inset`: a 960px
maximum including gutters, 20px horizontal / 24px vertical on smaller screens,
28px horizontal / 32px vertical on desktop. Settings, Tasks, Runs, Artifacts,
Plugins and Bots share these dimensions. Tool canvases and chat keep their
purpose-specific widths. Use 4, 8, 12, 16, 24 and 32px spacing roles for new
component interiors and section separation. Compact icons can keep optical
adjustments. Retain touch targets and wrapping on small screens.

Composer menus use primary label and secondary description roles, including
portalled menus. Shared dialog, sheet, card, command and form primitives use
the same roles. Feature CSS modules must reference these tokens rather than
reintroducing fixed 9–21px sizes or intermediate font weights.

Verification for the September 9 consistency pass: browser visual inspection
of Bots, Tasks, Settings, Plugins, Runs, Artifacts, Studio and conversation
surfaces; targeted component tests and TypeScript. This is a shared-style
consistency pass, not a claim that every possible state was visually tested.
