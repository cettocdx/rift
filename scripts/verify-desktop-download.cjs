#!/usr/bin/env node
// Explicit release gate; intentionally fails while the public DMG has no current
// canonical build provenance. Never installs or launches the mounted app.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sha256 } = require("./package-local-cli.cjs");
const root = path.resolve(__dirname, "..");
const requiredCommands = [
  "synchronize_desktop_terminal_owner",
  "create_desktop_profile_pty_v2",
  "read_desktop_profile_pty_output",
  "acknowledge_desktop_profile_pty_output",
];
// Explicit source closure of the canonical desktop build. Generated loader and
// target outputs are excluded: the loader's source inputs are included instead.
function desktopBuildInputs(repository = root) {
  const required = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "packages/desktop/package.json",
    "packages/desktop/src-tauri/Cargo.toml",
    "packages/desktop/src-tauri/Cargo.lock",
    "packages/desktop/src-tauri/build.rs",
    "packages/desktop/src-tauri/tauri.conf.json",
    "packages/desktop/src-tauri/entitlements.plist",
    "packages/desktop/scripts/build.js",
    "packages/desktop/scripts/boot-runtime.js",
    "packages/desktop/scripts/launch.template.html",
    "components/launch/launch-screen.css",
    "public/brand/Rift-Symbol-Black.svg",
  ];
  const files = new Set(required);
  const walk = (relative) => {
    if (relative === "packages/desktop/src/index.html") return;
    const absolute = path.join(repository, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`Desktop build inputs cannot be symlinks: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort())
        walk(`${relative}/${child}`);
    } else if (stat.isFile()) files.add(relative);
  };
  for (const directory of [
    "packages/desktop/src",
    "packages/desktop/src-tauri/src",
    "packages/desktop/src-tauri/permissions",
    "packages/desktop/src-tauri/capabilities",
    "packages/desktop/src-tauri/icons",
    "packages/desktop/src-tauri/.cargo",
    "packages/desktop/.cargo",
    ".cargo",
  ])
    walk(directory);
  // Platform overlays are automatically consumed by Tauri when present.
  for (const file of [
    "packages/desktop/src-tauri/Info.plist",
    "packages/desktop/src-tauri/tauri.macos.conf.json",
    ".npmrc",
    "rust-toolchain.toml",
    "rust-toolchain",
  ])
    walk(file);
  const entries = [...files].sort().map((file) => {
    if (!fs.lstatSync(path.join(repository, file)).isFile())
      throw new Error(`Invalid desktop build input: ${file}`);
    return {
      path: file,
      sha256: sha256(fs.readFileSync(path.join(repository, file))),
    };
  });
  return {
    sha256: sha256(Buffer.from(JSON.stringify(entries))),
    files: entries,
  };
}
function validateDesktopProvenance(manifest, archiveSha256, buildInputsSha256) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.productName !== "RIFT" ||
    manifest.identifier !== "app.riftsys.desktop" ||
    manifest.launchUrl !== "https://riftsys.app/login" ||
    manifest.archive !== "RIFT-mac.dmg" ||
    manifest.architecture !== "arm64" ||
    manifest.archiveSha256 !== archiveSha256 ||
    !/^[a-f0-9]{64}$/.test(manifest.executableSha256 || "") ||
    typeof manifest.version !== "string" ||
    !manifest.version ||
    manifest.notarized !== false ||
    manifest.signing !== "ad-hoc"
  ) {
    throw new Error(
      "Desktop download lacks matching canonical build provenance. Do not publish a stale or UI Preview DMG.",
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(buildInputsSha256 || "") ||
    manifest.buildInputsSha256 !== buildInputsSha256
  )
    throw new Error(
      "Desktop download build inputs are missing or stale. Rebuild the canonical DMG from the current source.",
    );
}
function verifyDesktopDownload(
  directory = path.join(root, "public/downloads"),
) {
  const manifestPath = path.join(directory, "RIFT-mac.manifest.json");
  if (!fs.existsSync(manifestPath))
    throw new Error(
      "Desktop download is unverified: RIFT-mac.manifest.json is missing. Build and inspect the canonical DMG before publishing downloads.",
    );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const archive = path.join(directory, "RIFT-mac.dmg");
  validateDesktopProvenance(
    manifest,
    sha256(fs.readFileSync(archive)),
    desktopBuildInputs().sha256,
  );
  if (process.platform !== "darwin")
    throw new Error(
      "Desktop download verification requires macOS to inspect the DMG.",
    );
  const mount = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-desktop-download-"),
  );
  let attached = false;
  try {
    execFileSync(
      "hdiutil",
      ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, archive],
      { stdio: "pipe", timeout: 30000 },
    );
    attached = true;
    const app = path.join(mount, "RIFT.app");
    const plist = path.join(app, "Contents/Info.plist");
    const value = (key) =>
      execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
        encoding: "utf8",
      }).trim();
    if (
      value("CFBundleIdentifier") !== manifest.identifier ||
      value("CFBundleShortVersionString") !== manifest.version
    )
      throw new Error(
        "Mounted desktop identity/version does not match canonical provenance.",
      );
    const executable = value("CFBundleExecutable");
    if (path.basename(executable) !== executable)
      throw new Error("Invalid desktop executable path.");
    const executablePath = path.join(app, "Contents/MacOS", executable);
    const binary = fs.readFileSync(executablePath);
    const architectures = execFileSync("lipo", ["-archs", executablePath], {
      encoding: "utf8",
    }).trim();
    if (architectures !== manifest.architecture)
      throw new Error(
        "Mounted desktop architecture does not match provenance.",
      );
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
      stdio: "pipe",
      timeout: 30000,
    });
    if (
      sha256(binary) !== manifest.executableSha256 ||
      requiredCommands.some((command) => !binary.includes(Buffer.from(command)))
    )
      throw new Error(
        "Desktop download is stale or lacks the bounded terminal contract.",
      );
    return manifest;
  } finally {
    if (attached)
      execFileSync("hdiutil", ["detach", mount], {
        stdio: "pipe",
        timeout: 30000,
      });
    fs.rmdirSync(mount);
  }
}
module.exports = {
  desktopBuildInputs,
  validateDesktopProvenance,
  verifyDesktopDownload,
};
if (require.main === module) {
  try {
    const manifest = verifyDesktopDownload();
    console.log(
      `Verified canonical DMG content (not notarized): ${manifest.archiveSha256}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
