# Native window geometry comparison

The installed Cursor 3.20.10 client requests a hidden titlebar and native shadow. Its JavaScript does not request the empty Unified NSToolbar that RIFT previously installed. RIFT's native experiment removes that extra toolbar while preserving native decorations, shadow, transparent titlebar, separator suppression and web drag regions.

CUA captured `/tmp/rift-cursor-window.png`, `/tmp/rift-native-window.png` and `/tmp/rift-native-window-after.png`. At the top-left corner, the first pixel whose RGB channels are all below 100 occurs at these x positions:

| Scan row | Cursor | RIFT before | RIFT without empty toolbar |
| -------- | -----: | ----------: | -------------------------: |
| 0        |     18 |          26 |                         14 |
| 4        |      6 |          11 |                          5 |
| 8        |      3 |           6 |                          2 |
| 12       |      1 |           4 |                          1 |
| 20       |      0 |           1 |                          0 |

These are capture-pixel contour observations, not fitted physical corner radii. Captures have different window widths (1204, 1290 and 1229 pixels respectively), and shadow outside the cropped window is not measured. The extra toolbar demonstrably affected the mask; universal pixel equality is not established.

Removing the toolbar restored compact controls but left them too high relative to the web header. The final local package uses x18/y27 traffic-light positioning and public AppKit coordinate conversion from the outer titlebar container into each button parent. The target is guarded against leaving the parent's hit-test bounds. Wry resizes the outer container and preserves the button origin, so using the web content frame as the origin produced incorrect vertical offsets and was discarded.

Final CUA inspection showed the traffic lights aligned with the adjacent web header. Native zoom changed the OS-reported window bounds from 1280×800 at (116,69) to 1512×872 at (0,33); zooming back restored the original bounds. The aligned controls remained visible after resizing. Package relaunch restored the existing conversation. This is validated on the current Mac, not across all macOS versions.

CUA drag attempts did not demonstrate window movement; the comparison attempt in Cursor Agents returned `noWindowsAvailable`. Drag acceptance remains open, and no successful drag claim is made. Fullscreen entry via the native green control and return via View menu restored the original window bounds. The View menu continued to label the action Enter Full Screen while fullscreen; this menu-label defect remains open. Native minimize/close button hit-testing remains to be completed separately from the successful native zoom action and Cmd+Q/relaunch.

The final Tauri UI Preview application packaging passed and the installed Applications bundle passed `codesign --verify --deep --strict`. It uses local ad-hoc signing; notarized public distribution remains outstanding. The previous package was preserved at `/tmp/RIFT-UI-Preview-before-corner.app`. All controlled replacements had zero active/starting claims in the run gate (269 released claims).

Related live verification: the edited-files Review action opened a Review tab with all seven changed files, known-diff totals and explicit missing-diff disclosure. Expanding EarlyAccessModal.tsx opened Diff/Original/Modified views. It no longer routes Review directly to the first edited file.
