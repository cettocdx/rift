const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateDesktopProvenance,
  verifyDesktopDownload,
  desktopBuildInputs,
} = require("../verify-desktop-download.cjs");
const digest = "a".repeat(64);
const canonical = {
  schemaVersion: 1,
  productName: "RIFT",
  identifier: "app.riftsys.desktop",
  launchUrl: "https://riftsys.app/login",
  archive: "RIFT-mac.dmg",
  archiveSha256: digest,
  executableSha256: "b".repeat(64),
  version: "0.1.0",
  architecture: "arm64",
  signing: "ad-hoc",
  notarized: false,
  buildInputsSha256: digest,
};
test("desktop release gate requires provenance before inspecting an unverified release archive", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-download-gate-"),
  );
  try {
    assert.throws(() => verifyDesktopDownload(temporary), /unverified/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
test("preview identity, loopback launch targets, stale bytes and unsupported notarization claims fail closed", () => {
  validateDesktopProvenance(canonical, digest, digest);
  for (const change of [
    { identifier: "app.riftsys.ui-preview" },
    { productName: "RIFT UI Preview" },
    { launchUrl: "http://localhost:3020/" },
    { launchUrl: "http://localhost:3022/" },
    { archiveSha256: "c".repeat(64) },
    { executableSha256: null },
    { notarized: true },
    { architecture: "x64" },
  ])
    assert.throws(
      () =>
        validateDesktopProvenance({ ...canonical, ...change }, digest, digest),
      /canonical build provenance/,
    );
});

test("a self-consistent archive cannot pass with missing or stale source inputs", () => {
  assert.throws(
    () =>
      validateDesktopProvenance(
        { ...canonical, buildInputsSha256: undefined },
        digest,
        digest,
      ),
    /build inputs/,
  );
  assert.throws(
    () => validateDesktopProvenance(canonical, digest, "c".repeat(64)),
    /build inputs/,
  );
});

test("desktop freshness includes native and shared launcher inputs, additions and removals, but ignores build output", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "rift-native-inputs-"),
  );
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
    fs.writeFileSync(path.join(temporary, file), content);
  };
  try {
    for (const file of [
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
      "components/icons/rift-logo.tsx",
      "public/brand/Rift-Symbol-Black.svg",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
      "packages/desktop/src-tauri/src/lib.rs",
    ])
      write(file, "original");
    const first = desktopBuildInputs(temporary);
    write("packages/desktop/src-tauri/target/release/output", "compiled");
    write("packages/desktop/src/index.html", "preview loader");
    write("app/page.tsx", "web only");
    write("components/icons/rift-logo.tsx", "web renderer only; native reads the approved SVG");
    assert.deepEqual(desktopBuildInputs(temporary), first);
    write("packages/desktop/src/extra.js", "bundled sibling");
    assert.notEqual(desktopBuildInputs(temporary).sha256, first.sha256);
    fs.unlinkSync(path.join(temporary, "packages/desktop/src/extra.js"));
    assert.deepEqual(desktopBuildInputs(temporary), first);
    for (const file of [
      "packages/desktop/src-tauri/src/lib.rs",
      "components/launch/launch-screen.css",
      "public/brand/Rift-Symbol-Black.svg",
    ]) {
      write(file, "changed");
      assert.notEqual(desktopBuildInputs(temporary).sha256, first.sha256);
      write(file, "original");
    }
    write("packages/desktop/src-tauri/Info.plist", "custom bundle properties");
    assert.notEqual(desktopBuildInputs(temporary).sha256, first.sha256);
    fs.unlinkSync(
      path.join(temporary, "packages/desktop/src-tauri/Info.plist"),
    );
    write("packages/desktop/src-tauri/src/new.rs", "new module");
    assert.notEqual(desktopBuildInputs(temporary).sha256, first.sha256);
    fs.unlinkSync(
      path.join(temporary, "packages/desktop/src-tauri/src/new.rs"),
    );
    assert.deepEqual(desktopBuildInputs(temporary), first);
    fs.unlinkSync(
      path.join(temporary, "packages/desktop/src-tauri/Cargo.lock"),
    );
    assert.throws(() => desktopBuildInputs(temporary), /ENOENT|missing/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
