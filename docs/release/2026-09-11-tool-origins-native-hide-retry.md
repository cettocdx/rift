# Tool origins and acknowledged native browser visibility

## Provider and storage ownership

Tool construction captures the originating provider configuration and generated-media storage client/service key. Late image, video, moderation and search calls, as well as model-specific tool rebuilds, retain that snapshot. A later worker configuration cannot add tools or lend missing credentials to an earlier run. Generated-media upload, metadata save and failure cleanup use the same captured storage authority. Missing scoped storage rejects before paid generation.

Pricing, tool availability policy, cancellation, provider defaults and existing cost callbacks are retained. Process reuse remains off. The focused origin matrix reproduced eight failures before the fix; 97 tests across 13 relevant suites pass. Image/search/moderation/download use HTTP stubs; Convex transport and SDK video generation are mocked. The installed OpenRouter model/header factory is exercised. This is not a live provider receipt reconciliation or latency benchmark.

## Native browser visibility

Desired UI visibility was previously used as if it acknowledged a native hide. If the IPC hide failed, an inactive tab's early return prevented retries and could leave a native browser visible over another panel. Native visibility is now tracked conservatively until hide succeeds. Failed hides retry through the existing interval at most once per second; acknowledged hidden tabs return to the idle fast path. A lost show response also retains window-wide hide eligibility.

Eighteen component tests pass, including failed tab-hide, failed document-hide and lost show acknowledgement regressions. This fixes a demonstrated IPC-state bug, but a native call that never settles remains outside this retry mechanism.

## Native investigation and isolated fixture

The previous blank Activity panel persisted after Cmd+R and a small resize. Explicit View → Reload RIFT, which reloads the main document rather than a focused/visible child browser, restored visible Activity content on the current preview. This narrows the cause but does not prove the failed-hide path caused that incident.

A separate loopback fixture uses actual SidebarHistory, WorkbenchDock and AgentActivityPanel with the exact outer reveal wrapper, synthetic chats and disabled services. Chromium/WebKit × light/dark: four tests pass with normal animations and read-only style/animation diagnostics. The fixture does not change production gates/routes or inspect user content. A separately built native RIFT Render Diagnostics application uses the same native window/vibrancy settings, a different identifier and no IPC capabilities; initial native sidebar navigation and Activity rendering were correct. Test routing, bundle mode, service stubs and absence of native child browser views remain important differences from the authenticated app.
