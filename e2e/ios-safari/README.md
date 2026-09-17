# Standalone Safari acceptance

This XCUITest bundle targets Safari. It has no RIFT app dependency and does not install or replace `app.riftsys.ios`. It uses production React components with isolated fixture data; it does not sign in, send an agent task, or call a model/tool backend.

Generate the project outside the checkout:

```sh
mkdir -p /tmp/rift-physical-safari-project
xcodegen generate --spec e2e/ios-safari/project.yml --project /tmp/rift-physical-safari-project
```

Start two fixture servers from the repository root, each in a separate terminal. Replace the example LAN address with the Mac’s current private IPv4 address. The server rejects wildcard, public and nonlocal binds; its default remains loopback.

```sh
RIFT_FIXTURE_HOST=192.168.1.17 RIFT_FIXTURE_PORT=3070 RIFT_TRANSCRIPT_FIXTURE=1 RIFT_MOBILE_TOOLS_FIXTURE=1 node e2e/mobile-fixture/server.cjs
```

```sh
RIFT_FIXTURE_HOST=192.168.1.17 RIFT_FIXTURE_PORT=3071 RIFT_HACK_FIXTURE=1 node e2e/mobile-fixture/server.cjs
```

Run `xcodebuild test` with this project and the `SafariAcceptance` scheme. Provide the actual device destination, a valid development team, a temporary derived-data directory and these build settings:

- `RIFT_SAFARI_BUILD_URL=http://192.168.1.17:3070/lab/composer?mobileTools=1&realPreview=1`
- `RIFT_SAFARI_HACK_URL=http://192.168.1.17:3071/lab/composer`

Quote URLs in the shell. Physical devices must be unlocked, paired, in Developer Mode and able to reach the Mac. A successful build does not mean tests ran. Check the result bundle for actual execution and failures/skips. Stop the fixture servers after testing.

## 2026-09-17 execution boundary

The runner builds for the connected physical iPhone and simulator. Physical execution was blocked by the device lock and later lost its pending connection before launch. Simulator XCUITest stalled in Apple’s accessibility loading, before product assertions; it was stopped. Neither is recorded as a passing automated device run.

Direct Device Hub interaction with Safari on iOS 26.5 verified the Build software keyboard layout, Activity open/close, and clicking the embedded preview button. It also reproduced the mobile Hack header opening an invisible desktop rail. After the fix, the same header visibly opens the existing task dialog. See the reliability report for independent Chromium/WebKit assertions.
