# Telemetry origin isolation and native sidebar investigation

Every worker run captures its analytics and log destinations with its database/provider scope. Delayed callbacks, retries and final flushes retain that origin, including missing configuration. Unscoped web calls follow configuration changes; shutdown can drain all pending origins.

OTLP queues are bounded to 1,000 aggregate records and 32 origins; pending analytics clients are bounded to 32. Idle origins can be retired to avoid permanent admission starvation. Active SDK flushes, including the SDK's automatic 20-event threshold, cannot be retired prematurely. Aggregate counters describe local discards/retirements, not confirmed remote delivery loss. No destination or credential is included in these counters.

An actual installed-SDK regression holds 32 automatic HTTP flushes, attempts admission of a 33rd origin, and checks that the original scoped completion still waits. Transport is stubbed; no external telemetry or paid tasks are needed.

## Native rendering investigation

In RIFT UI Preview, switching conversations changed URL, content and accessibility state while the selected sidebar background could remain on the previous conversation. Unmounting/remounting the sidebar repaired the selection. The Activity panel was also observed in accessibility state while its right-hand visual area remained blank. The authenticated Chrome view selected the correct conversation.

A new isolated fixture uses the actual SidebarHistory, SidebarConversation, ChatItem, useChatNavigation and production CSS. Chromium/WebKit, light/dark: 4 tests passed with 20 navigation clicks, checking URL, body, active attributes and screenshot pixels for all rows. Normal animations are preserved. It did not reproduce the native failure, so no speculative production sidebar/style fix was made.

The fixture uses a reactive router adapter and disabled service boundaries; it does not exercise Next App Router, authenticated navigation or the native WKWebView host/compositor. Native rendering remains unresolved and browser success is not evidence of desktop parity.
