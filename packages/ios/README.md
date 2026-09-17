# RIFT for iOS — native preview

This is an installed SwiftUI application, not a PWA or a WKWebView shell. The existing RIFT backend remains responsible for authentication, task execution, permissions and billing.

## Design baseline — iOS and iPadOS 27

User requirement: use Apple's iOS/iPadOS 27 design system as the native app design baseline.

- Official UI components: [Apple iOS and iPadOS 27 UI Kit](https://www.figma.com/community/file/1651309003795292092/ios-and-ipados-27), linked from [Apple Design Resources](https://developer.apple.com/design/resources/).
- Icon reference: [user-provided App Icon Template](https://www.figma.com/design/lxTnJtnMPCtP5kEPU13Lt8/?node-id=25-5). Node 25:5 is its Cover page, not a screen-component library. Keep the editable RIFT Icon Composer source as the app icon implementation.
- Implement interaction with native SwiftUI controls: navigation, menus/pickers, sheets, alerts, forms, semantic typography and system colors. Use the design kit for visual specifications, not rasterized replacements for controls.
- Adapt navigation to iPad width and multitasking; do not simply enlarge the phone drawer. Check Dynamic Type, VoiceOver, keyboard/pointer, safe areas and reduced motion.
- As verified on 2026-09-15 after the Xcode update, this machine has Xcode 27.0 (27A266a) and an installed iOS Simulator 26.5 runtime. Do not claim iOS/iPadOS 27 runtime validation until that runtime is installed and the app is tested there. Gate version-specific APIs and keep supported OS fallbacks.

## Open and run

Keep code signing enabled for Simulator builds: Keychain requires the app signature. Do not pass `CODE_SIGNING_ALLOWED=NO`; use the default simulator ad-hoc signing (`CODE_SIGN_IDENTITY=-`) when invoking xcodebuild.

Open `RIFT.xcodeproj`, select the RIFT scheme and an iPhone simulator. `project.yml` is the reproducible XcodeGen source. Regenerate with `xcodegen generate --spec packages/ios/project.yml` from the repository root.

On this Xcode 27 installation, the simulator window is in
`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`; the older
`Contents/Developer/Applications/Simulator.app` path is absent. Open Device Hub
and select RIFT iPhone 17 before keyboard UI tests. Headless CoreSimulator boot
alone did not show the software keyboard here; the same test passed with the
device window open, without changing the keyboard assertion.

Debug uses `http://localhost:3046`. Release uses `https://riftsys.app`. A physical phone needs an accessible HTTPS backend; its localhost is the phone itself. Override `RIFT_SERVER_URL` as an Xcode build setting when needed. No backend secrets belong in the app.

The corresponding `/api/mobile/session` and `/api/mobile/stream` routes must be deployed on that backend before live native chat works. The desktop preview is not automatically restarted by an iOS build.

## Implemented

- Native SwiftUI navigation, draggable history drawer, composer, model/effort menus, grouped Settings and usage screen.
- OLED black default with Dark, Light and System appearance selection.
- Monthly usage lives only in Settings; drawer footer has New chat and Settings.
- Existing email/password sign-in and refresh API. Auth cookies are stored in Keychain with `WhenUnlockedThisDeviceOnly`; no password persistence.
- Owner-checked conversation pagination and history adapters; no service key is exposed to the client.
- Existing durable agent stream, explicit GET reconnect and server-confirmed cancellation. Reconnect does not repeat a POST.
- Build, Studio and Hack send `approvalMode: full` (Run freely) for every new task. No in-app tool consent is requested; server authorization and iOS system permissions still apply. Existing historical tasks retain their original saved approval policy. Studio SSE keep-alives also support older approval-waiting tasks.
- Build, Studio generation/download/share preparation, and Hack fixture review/report opening verified in the signed iPhone simulator.
- Paginated transcripts, saved/live activity, chronological media rendering, provider logos and native file preview/download controls.
- RIFT brand mark and editable `Resources/RIFTIcon.icon` Icon Composer document.

## Not yet release-ready

- Google and Apple native sign-in, registration and email-verification screens.
- End-to-end authenticated task verification against the deployed mobile routes, including background/foreground, expiry and airplane mode.
- Full project/GitHub parity and broader Studio/Hack scenarios; validate all question/attachment types and actual external share destinations.
- Stress testing of older transcript pagination and streaming replay, long-transcript profiling, VoiceOver and accessibility text-size acceptance.
- Real device battery/performance checks, signing, TestFlight and App Store distribution.

Do not describe this preview as complete feature parity, an App Store release, or a fully tested production client.
