# Local runner restoration on this Mac

Desktop was running but the standalone command runner was absent. The target
list still contained connection 01b3768e-86ad-4694-b320-80f6ac302c5e with lastSeen
1781866658065. Desktop production deliberately registers file/device access
without arbitrary command capabilities; that bridge is not a Build runner.
The standalone runner also expires after one idle hour by default.

Added explicit --keep-alive mode and RIFT_LOCAL_TOKEN environment input. The
normal ad-hoc idle timeout stays intact. A new idle regression failed before
the change; all 19 local runner tests pass and its TypeScript build passed.

Restored this user's authenticated runner with owner-only configuration at
~/.config/rift/local-runner.json. No token is passed in process arguments.
Installed ~/Library/LaunchAgents/app.riftsys.local-runner.plist (RunAtLoad,
KeepAlive, 30-second restart throttle), using scripts/local-runner-service.cjs.
It survives closing the UI and starts at user login. This is a macOS service
installation on this development machine, not a newly bundled Desktop release.

Actual authenticated relay command returned Darwin, /Users/cetto,
RIFT_LOCAL_OK, exit 0. New target: Ahmet Mac · RIFT Local. Removed the old
owned connection from the connected list. Existing Cloud work was not moved.

Remaining product work: package/manage the service within distributed Desktop,
show live presence rather than stored connection status, and bind selections
to durable devices across runner re-registration. OS sleep/network loss and
provider failures are not eliminated by the service.

To stop/remove this local service:
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/app.riftsys.local-runner.plist
Then remove that plist; credentials can be revoked from RIFT settings.
