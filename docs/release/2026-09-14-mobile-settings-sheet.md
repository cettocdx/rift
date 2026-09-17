# Mobile settings sheet positioning

The running Preview at localhost:3020 rendered the 390px-wide Chat settings
sheet at x=-195px, y=315.25px. Computed styles showed `translate: -50% -50%`:
the bottom sheet inherited the shared centered dialog's translation utilities.
Its left half, including labels, was outside the viewport.

DialogContent now has an explicit bottom placement. That placement never adds
the centered dialog's top/left/translation/zoom utilities. Center remains the
default for existing dialogs; the mobile settings sheet requests bottom.

Six MobileComposerSettings component tests passed. The isolated source-rendered
composer was inspected through the browser at 360x780, 390x844, 430x932 and
667x375: x=0, full viewport width, bottom aligned, translate=none, and the entire
panel inside the viewport in all four measurements. The existing browser fixture
test now asserts geometry as well as visibility. These are responsive desktop
browser observations, not physical iOS/Android keyboard acceptance.

GitHub credential diagnosis was separately repeated: the configured OAuth pair
received HTTP 404 instead of `bad_verification_code` for an intentionally invalid
code. No token was issued. Browser authorization/repo flow remains blocked by
the registered app configuration; this UI fix does not claim GitHub completion.
