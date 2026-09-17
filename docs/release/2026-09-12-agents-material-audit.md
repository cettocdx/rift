# Agents material and typography audit

Source: installed Cursor `workbench.glass.main.js` and `.css`, read on
2026-09-12. Live Cursor accessibility inspection timed out (-10005); this is
source-token verification, not a pixel-equivalence or performance result.

| Role                  | Cursor source                 | RIFT Graphite                 |
| --------------------- | ----------------------------- | ----------------------------- |
| Dark base text        | #F0F0F0                       | #f0f0f0                       |
| Secondary text        | base at 74% alpha             | 74% alpha                     |
| Tertiary text         | base at 60% alpha             | 60% alpha                     |
| Secondary icon        | base at 66% alpha             | corrected from 60% to 66%     |
| Dark sidebar material | 36% surface                   | 36% when translucency enabled |
| Dark main material    | 72% surface                   | 72% when translucency enabled |
| Light sidebar / main  | 42% / 84%                     | 42% / 84%                     |
| UI font               | platform system font fallback | platform system font          |

New installations previously defaulted to opaque panels, so material rules
could exist without being visible. New defaults now enable translucency.
Saved preferences are preserved. High contrast and reduced transparency still
use opaque surfaces. No proprietary font was copied or renamed.

RIFT's quaternary text remains deliberately brighter than Cursor's 36% alpha
role. Native blur, wallpaper, system accessibility settings and the selected
palette affect final pixels. The current signed/installed application and its
saved appearance selection must still be checked live before claiming parity.

Date grouping already exists in SidebarHistory (Today, Yesterday, Older).
This pass does not introduce simulated reasoning or activity indicators.

Validation: 32 theme/sidebar tests and 46 appearance/bootstrap tests passed.
