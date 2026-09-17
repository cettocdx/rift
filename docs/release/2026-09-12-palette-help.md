# Selected command help

The installed native palette truncated `/goal` and `/mcp` descriptions. Full explanations previously depended on native hover titles, which are not a dependable touch or keyboard help surface.

Keep the established menu, type, colors and 44px command targets. The selected command now has a separate wrapping description and full usage inside the same menu. List and help scroll independently within the available viewport while their allocated heights can reveal a full control; keyboard hints disappear first when constrained, followed by the nonessential header. At severely constrained heights the outer menu owns help scrolling, with a 44px Back to commands action. Compact rows show the command label alone; the complete description remains in help so a full 44px row fits without clipping. The list can chain scrolling into that outer menu; full help is not trapped in another tiny scrollport. A four-pixel gap replaces the normal eight only at the minimum control-height boundary, preserving separation from the composer. Bottom placement anchors below the whole composer so it does not cover toolbar actions.

Touch interaction deliberately separates inspection from execution: tapping a command selects its help; the 44px Use button applies it. Mouse clicks, unmodified Enter/Tab, and activation clicks with no touch pointer intent retain direct application. A scrolling touch gesture does not intentionally apply an option. Plain F1 focuses help for keyboard scrolling, Escape there returns to the unchanged composer, and Escape from the composer closes the menu. Composition and modified editing keys retain the prior guards.

Unit evidence: six new regression cases were demonstrated failing across the initial help, touch, compact return and minimum-gap stages. Final full palette and ChatInput integration suites pass66/66 (3.907s); source TypeScript, scoped ESLint, formatting and diff-check pass. Logs: /tmp/rift-palette-help-unit-red.log, /tmp/rift-palette-help-touch-red.log, /tmp/rift-palette-help-compact-unit-red.log, /tmp/rift-palette-help-gap-unit-red.log, /tmp/rift-palette-help-final-unit-green.log, /tmp/rift-palette-help-final-tsc.log and /tmp/rift-palette-help-final-lint.log. Browser and final static verification results are recorded separately; this note does not claim actual native post-fix validation or OS keyboard testing.

## Reference and evidence boundaries

Cursor Agents was directly revisited in the installed running app at `/Volumes/Cursor Installer/Cursor.app`; the IDE button was not used. Its compact model/context/effort popup and restrained transcript/Apps hierarchy remain interaction references. This change implements readable selected command help in RIFT rather than claiming access to Cursor’s private runtime or equal frame performance.

Independent Chromium/WebKit verification, final repository gates, build identity and served native observations are recorded in the external milestone report. Physical mobile keyboard and native touch-swipe behavior are not established by viewport emulation.

## Independent review follow-up

The initial 24-case browser run passed 23 cases and found a real desktop keyboard issue: immediately selecting the final command during the entrance scale animation left part of that row clipped. Root visual review also rejected a partially visible Use control at the initial help position in an otherwise tall viewport. Both are release acceptance checks, not results to waive by increasing test tolerances. Final corrected evidence is recorded externally.

The first full repository hook run passed 680 suites but failed one existing exact-constructor assertion because the new relay-origin parameter was not expected. The assertion was extended to require absent captured client/service authority while retaining the original local-selection and no-cloud-fallback checks; its nine focused policy tests then passed.
