# Mobile workbench file navigation

Root cause: Explorer loaded the selected file but EditorPane remained hidden
below lg, and the mobile surface state had no editor destination. Added an
editor destination and switch on Explorer selection and Changes Open File.
Repeated selection of an already active path also switches. The editor remains
mounted; Files is highlighted while editing. Desktop lg visibility is retained.

Verification: initial focused regression failed with surface still Files. After
fix, 23 focused Jest tests passed. Eight browser cases passed in Chromium/WebKit
at 360/390/430 touch and 1200 desktop. They compile production shell/Explorer CSS
and prove editor parent visibility, repeated same-file opening, DOM and textarea
draft retention, terminal hiding, and viewport containment. Screenshots inspected.

These are in-memory provider/textarea boundary fixtures, not authenticated file
reads, Monaco editing, or real phone keyboard acceptance. Do not claim complete
mobile acceptance from these tests. Existing mobile-tools suite separately passed
30 cases covering Activity/Preview and history navigation.

## Real provider and editor chrome follow-up

Replaced provider stub with actual WorkbenchProvider and real ActiveEditor/tabs.
Only Monaco's dynamic boundary remains a controlled textarea. In-memory adapter
records exact reads/writes. Sixteen Chromium/WebKit cases at 360/390/430 touch and
1200 desktop pass: dirty state, repeated opening without re-read, actual More
save, stored content/revision, injected save failure, actual Retry save and
successful recovery. No unexpected or skipped browser cases.

Editor retry/read/conflict controls now retain desktop height but provide 44px
minimum touch height. Retry save's rendered geometry was measured in the fixture.
Monaco initialization/CDN, real backend and physical keyboard remain unverified.
