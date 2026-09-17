# Download artifact checks

The web download `public/downloads/rift-cli.tgz` is the `packages/local`
receiver. It is separate from the standalone `packages/console` CLI release.

Run `pnpm local-sandbox:package` after receiver changes. Standard web builds
(`pnpm build`) and the isolated UI release build invoke this builder before Next.
It compiles copied source into a temporary package, includes every emitted
runtime module, and uses `npm pack --ignore-scripts` after that explicit compile.
It neither installs dependencies nor changes a running receiver's
`packages/local/dist`. A direct `npm pack` in `packages/local` has a `prepack`
hook that cleanly rebuilds that package's own dist.

`rift-cli.manifest.json` records archive SHA-256, package version, source-input
SHA-256, compiler/Node/npm versions, and the archive file list. Source inputs
include the receiver source/config/package/local lock/README, the workspace
lockfile and workspace configuration used by CI, root LICENSE, and the packaging
script. The manifest lists these inputs explicitly. No timestamps or checkout paths are embedded. Use the recorded
Node/npm versions and frozen pnpm lockfile to reproduce exact archive bytes.
Settings connection commands include the archive hash as a URL cache key, so a
new archive does not reuse an older npx download with the same package version.
The public package version remains unchanged until an explicit version release.
Archive and manifest files are each replaced atomically; deploy them together.
This reproduces package bytes, not the future dependency graph of an npm install:
runtime dependencies retain their declared semver ranges.

Run `pnpm local-sandbox:verify` to rebuild/compare the committed archive and
perform an isolated temporary npm install. The smoke install downloads declared
JS dependencies, skips install scripts and optional node-pty, and then verifies
help, unauthenticated failure, and all runtime imports, including the dynamically
spawned command worker. Runtime probes block network and child-process creation;
they do not authenticate or execute commands. This check proves the JS receiver
starts independently of workspace dependencies. It does not certify the optional
native node-pty installation or a live authenticated connection.

## Desktop release gate

The DMG inherited from baseline commit `5219126` is **not release-ready**: its
6,694,272-byte RIFT binary lacks desktop owner synchronization and the v2 output
transport. Do not reuse it or substitute the locally installed UI Preview app.
`pnpm downloads:verify` fails closed until the canonical DMG has current matching
provenance and passes read-only inspection. The web/CLI build does not rebuild,
install, sign, notarize, or silently bless a DMG.

A canonical build uses `packages/desktop/src-tauri/tauri.conf.json`, product
`RIFT`, identifier `app.riftsys.desktop`, and the production launch URL. The
UI preview config changes identity/capabilities and disables bundling. Build in
an isolated target directory without preview config or debug flags:

```sh
env -u TAURI_CONFIG APP_URL=https://riftsys.app/login \
  CARGO_TARGET_DIR=/tmp/rift-canonical-desktop-target \
  pnpm --dir packages/desktop exec tauri build --bundles dmg
```

Before promoting that build, check the generated `packages/desktop/src/index.html`
launch config is exactly `https://riftsys.app/login`, inspect the resulting app's
identity and version, and retain the build's DMG/executable hashes. Do not copy
an earlier DMG from another target directory. The default canonical config uses
ad-hoc signing (`signingIdentity: "-"`); this is **not notarization** or a claim
that Gatekeeper accepts the public download.

After an inspected canonical build, stage the exact DMG as `RIFT-mac.dmg` with
`RIFT-mac.manifest.json` containing:

```json
{
  "schemaVersion": 1,
  "productName": "RIFT",
  "identifier": "app.riftsys.desktop",
  "version": "0.1.0",
  "launchUrl": "https://riftsys.app/login",
  "archive": "RIFT-mac.dmg",
  "archiveSha256": "SHA256_OF_THE_BUILT_DMG",
  "executableSha256": "SHA256_OF_ITS_MACOS_EXECUTABLE",
  "signing": "ad-hoc",
  "notarized": false
}
```

The manifest is build provenance, not a cryptographic attestation of the launch
URL. Create it from the explicit canonical build above, not by relabelling an
existing artifact. The release gate hashes the DMG, mounts it read-only on macOS,
checks identity/version/executable hash and the required native commands, and
detaches it without running or installing the app. Missing provenance, preview
identity/URL, stale hashes, or missing terminal commands block release.
