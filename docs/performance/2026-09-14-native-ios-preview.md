# Native iOS preview — 14 September 2026

## Scope

Created `packages/ios`: installed SwiftUI application, not a web wrapper. Studied the supplied ChatGPT recording and 27 Appllama reference screens; Apple navigation, SwiftUI, Keychain and Icon Composer resources. Figma metadata was unavailable because its connector returned the plan quota limit; no Figma edit was performed.

Native UI: OLED dark default, optional light/system appearance, draggable conversation drawer, New chat and Settings footer, grouped Settings, monthly usage in Settings, native keyboard and model/effort menus. RIFT's approved symbol is used in a layered Icon Composer document compiled by actool.

Native service: existing cookie-based email sign-in, Keychain persistence, authenticated chat/history projection, existing durable SSE task stream and explicit reconnect, cancellation confirmation and tool approval controls. Backend adapters preserve existing authorization and billing gates. Local development backend runs separately on port 3046; the desktop 3020 preview was not replaced.

## Verified

- Simulator build succeeded, including `RIFTIcon.icon` asset compilation.
- Three Swift reducer tests passed: live text, replay without early disappearance, persisted response replacement without duplication.
- Native UI test passed after rebuild and again without rebuilding: drawer → Settings → New chat → composer and keyboard, including exact draft text equality.
- Four API tests passed: no session, unavailable conversation, safe field projection, backend outage retaining session.
- Live unauthenticated session and stream requests return HTTP 401.
- TypeScript and targeted ESLint passed.
- Captured native screenshots under `output/ios-native/` (ignored from release source).

## Findings fixed during verification

Settings presentation was anchored to the root geometry instead of the visible drawer control; moved the sheet presentation to that control. Drawer hit testing now has explicit priority and the closed drawer is removed from the view tree. A repeat run exposed Simulator accessibility hit points of {-1,-1}, including on the menu button; the UI test now taps the actual button frame center and stops at the first failure. Subsequent rebuilt and repeat runs passed; this does not substitute for physical-device testing. XcodeGen initially omitted the icon resource; it is now an explicit resource reference and actool produces the installed app icon.

One Xcode UI test runner timed out preparing execution. Subsequent tests use the dedicated `RIFT iPhone 17` simulator, bounded execution and no parallel runner. This does not establish physical-device performance.

## Remaining before release

Authenticated live task verification; Google/Apple native sign-in and account recovery; choices/questions; attachments, media and download/share; full project and other RIFT surfaces; older history pagination; background/foreground recovery, expiry, accessibility and physical-device performance; signing and TestFlight. Full feature parity and release readiness are not claimed.

Final native suite: `/tmp/rift-ios-native-touch.xcresult` passed all four tests. The final run was recorded in `output/ios-native/navigation.mov`. Earlier recordings exposed the same invalid accessibility hit point on New chat and the composer; all navigation test taps now use element frame centers. The latest package was reopened in the dedicated simulator. No authenticated task or physical-device performance claim is made.
