# Bounded authenticated Chrome mobile audit

On September 11, 2026, a manual native Chrome UI audit inspected the existing
signed-in application at `http://localhost:3020/`. The running web revision was
`5368ce2`, as recorded by the release operator. This audit did not restart the
server or inspect authentication credentials.

Chrome DevTools selected **iPhone 12 Pro, 390 × 844**, with fit-to-window display
zoom and network throttling disabled. All navigation and interactions used native
Chrome UI automation; no page JavaScript, console commands, injected browser
fixtures, or DOM geometry probes were used.

## Observed paths and actions

| Surface    | Actions and bounded observation                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Homepage   | Opened and dismissed the model menu, Build/Plan mode menu, and reasoning popover. Their visible contents fit the emulated viewport. The final selections remained GPT-5.6 Sol, Plan, and Extra high. No message was submitted.                                                                                                                                                 |
| Tasks      | Navigated through the mobile drawer to `/tasks`; inspected the loaded task card, status filters, and run history. Visible content fit without a clipping blocker. No task or task action was invoked.                                                                                                                                                                          |
| Runs       | Navigated through the drawer to `/runs`; inspected the loaded status filters and run cards. Filters wrapped across rows, and visible cards fit. No run was opened or started.                                                                                                                                                                                                  |
| Agents     | Navigated through the drawer to `/agents`; inspected the loaded project chooser, Create project, disabled Add bot, and Agent profiles link. Controls fit. The project placeholder used an ellipsis within its allotted width. No project, bot, or profile was created or changed.                                                                                              |
| Appearance | Used the account menu's Settings navigation, then `/settings/appearance`. Inspected base appearance, font controls, sliders, switches, and reset control. Scrolled vertically, expanded Customize theme colors, and inspected the theme previews and color controls. Visible controls remained within the viewport. No setting, preset, color, import, or reset was activated. |

No reproducible clipping, horizontal overflow, or untappable navigation blocker
was found in these inspected paths. This is a visual and interaction observation,
not a measured geometry result or a claim about all content and controls.

Native accessibility clicks occasionally retained DevTools focus or targeted an
incorrect position under device scaling. Direct taps at screenshot-observed
coordinates reached the intended controls; outside taps dismissed the menus.
An incorrect accessibility target briefly opened an empty New project dialog;
it was dismissed without entering or submitting data. These automation effects
were not established as product defects.

## Restoration and limits

The audit returned Chrome to `/`, with the sidebar closed. Before disabling device
emulation, the device selector was restored to Responsive and its width was
confirmed as **340**. The device toolbar then reported disabled, and DevTools was
closed. The browser window was not resized. The final screenshot and accessibility
state show the desktop homepage, empty composer, disabled Send button, and the
unchanged Sol / Plan / Extra high selections. No native RIFT app was controlled.

This audit does **not** establish physical iOS or Safari/WebKit acceptance,
software-keyboard or safe-area behavior, comprehensive keyboard accessibility,
programmatic clipping/hit-test geometry, every route or control, or model execution.
It did **not** run the formal 132-case authenticated mobile suite. That suite's
status remains separate from this manual evidence. Network mutations were not
instrumented, so the no-change statement describes the intentional UI actions and
observed settings, not a claim that navigation emitted no background requests.

## Screenshot evidence

The screenshot skill captured the Chrome window. These are local temporary
artifacts, not repository assets or public links. Both the audit agent and release
operator visually reviewed the relevant captures. Hashes below identify the exact
PNG bytes; they do not establish assertions beyond the observations above.

Directory:
`/var/folders/wx/z8k5q55n7p3_xclljxndysv80000gn/T/`

| Capture                   | Filename                             | SHA-256                                                            |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Homepage                  | `codex-shot-2026-09-11_05-45-51.png` | `b1cd0ed2428bb37706eebfbe37a40f73983916ebdc65b2c4f9e11d456b60c029` |
| Model menu                | `codex-shot-2026-09-11_05-46-05.png` | `fb0e9abd180fc59b10ca750eb17b002e5702820bbf7454fad6d8754340d3cec3` |
| Mode menu                 | `codex-shot-2026-09-11_05-47-48.png` | `659867aefd677eb98f486d9a0abd78c2518e22e72c14db09b79a94ac487fd5e8` |
| Reasoning popover         | `codex-shot-2026-09-11_05-48-05.png` | `7ac7384017d61b9a5740a87f8508c77771989796656c481d885744622e789a4e` |
| Tasks                     | `codex-shot-2026-09-11_05-49-51.png` | `78f3b877dd9ea05e24fc6cfb97c63b2ad6e63b90f742183b5e16542d8d10e8fa` |
| Runs                      | `codex-shot-2026-09-11_05-50-04.png` | `43a3e991dc50d048df9ff4f9b269d5f923db5cf0900655c4a47fe1f035fce594` |
| Agents                    | `codex-shot-2026-09-11_05-50-17.png` | `f03c3fd5e8c16f30be3f891cc65fc78ca2f700c3efe8cf7fe12bce77185dcf30` |
| Appearance controls       | `codex-shot-2026-09-11_05-50-48.png` | `e3e7d099d53e1b7a36c5fd48ae46e6026afcf0b330b1bc4b2f655ab3a9fc3fc7` |
| Appearance theme previews | `codex-shot-2026-09-11_05-51-02.png` | `c84a7b153d388f387b437d96b3ee56c79c5509518e4f22478afdc73f04509a5c` |
| Restored desktop          | `codex-shot-2026-09-11_05-51-51.png` | `a816bf7540adda911e42bd218460f13f44b733f967f1b576df8508b6d20245c0` |
