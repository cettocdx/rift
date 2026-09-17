# Cursor workspace panel reference

Inspected the live installed Cursor Agents app, not its IDE: opened the plus
picker, dismissed it with Escape, selected Changes, and read its file list.
The user also supplied three screenshots showing the open-tab shelf, Changes,
and the searchable plus picker.

Implemented in the chat's actual WorkbenchDock:

- Plus opens a search-first picker with existing tabs and implemented tools.
- Existing tab selection reuses its body. New tool selection keeps the existing
  controller and browser-count guard. Escape restores the trigger without hiding
  the dock. No unimplemented shortcuts or destinations are advertised.
- Changes rows show filenames, directory context, per-file counts and an honest
  total. Missing diffs are excluded from totals and explicitly labeled.
- The review uses conversation execution data. It must not pretend these are a
  Git branch snapshot or invent a PR, file status or desktop session.

Verification: 27 focused component tests; real WorkbenchDock fixture in Chromium
and WebKit tests search, selection, Escape/focus, no-result state and viewport
containment. The fixture uses no authenticated service, PTY or model request.

The toolbar now also opens a dedicated workspace overview. It lists all open
panels vertically and exposes the same implemented tools. Panel bodies remain
mounted while hidden; WebKit pointer opening explicitly transfers focus into the
list so Escape works. The selected panel returns with its local state retained.
Layout placement now lives in the plus menu instead of occupying another toolbar
button. Four real-dock browser checks pass (Chromium/WebKit), alongside the
component state-lifetime test.

The remaining command search outline was reproduced with the full production
CSS composition: globals.css through the actual Tailwind compiler, followed by
workspace.css. The portal fallback now honors the command search's explicit focus
treatment, while ordinary inputs and buttons retain visible focus. Both browsers
pass the dedicated regression check.

Remaining reference gaps: desktop session integration, PR/branch controls backed
by actual repository data, and side-chat and subscriptions workflows. These are
not claimed complete by this change.

## Follow-up: recency and material fidelity

The user rejected visual parity: current RIFT glass values are approximations,
not measured Cursor opacity values. Corrected the CSS comment that overstated
their origin. Native translucency is also off in the default appearance config.
Cursor installed CSS includes system-font stacks; this does not establish the
computed font for every Agents element. No proprietary font was copied.

Restored Today / Yesterday / This week / Older sections using the existing
conversation update_time grouping. Groups collapse independently; the ten-row
cap, lazy row painting, pagination and Show more remain. A component regression
first failed on the flat Recent list and passes with real date groups.
Exact material/color/font metrics and active-run visual parity remain open.

## Verified dark glass surface weights

Installed Cursor Agents `workbench.glass.main.css` explicitly defines dark
sidebar/chat surface color weights of 36%/72% (light: 42%/84%). RIFT had
72%/92% in dark mode. Corrected these two CSS weights; retained accessibility
opaque overrides. These are reference CSS values, not measured final pixel
opacity or proof of cross-renderer visual parity. Native CUA inspection timed
out twice during this follow-up. No font files or glyph outlines copied.
