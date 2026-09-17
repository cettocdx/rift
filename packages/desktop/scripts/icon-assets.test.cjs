const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../../..");
const iconRoots = ["packages/desktop/src-tauri/icons", "src-tauri/icons"];
const hash = (data) => createHash("sha256").update(data).digest("hex");

function expectedSize(file) {
  if (file === "icon.png") return 512;
  if (file === "StoreLogo.png") return 50;
  const windows = file.match(/^Square(\d+)x\d+Logo\.png$/);
  if (windows) return Number(windows[1]);
  const png = file.match(/^(\d+)x\d+(?:@(\d)x)?\.png$/);
  if (png) return Number(png[1]) * Number(png[2] ?? 1);
  const iconset = file.match(/^icon\.iconset\/icon_(\d+)x\d+(?:@(\d)x)?\.png$/);
  if (iconset) return Number(iconset[1]) * Number(iconset[2] ?? 1);
  const ios = file.match(
    /^ios\/AppIcon-(\d+(?:\.\d+)?)(?:x[\d.]+)?@(\d)x(?:-1)?\.png$/,
  );
  if (ios) return Number(ios[1]) * Number(ios[2]);
  const android = file.match(
    /^android\/mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)\/ic_launcher(_round|_foreground|_monochrome)?\.png$/,
  );
  if (android) {
    const scale = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }[
      android[1]
    ];
    return (
      scale * (["_foreground", "_monochrome"].includes(android[2]) ? 108 : 48)
    );
  }
  assert.fail(`No platform size expectation for ${file}`);
}

test("native sources are byte-identical to the canonical approved web SVGs", () => {
  for (const [native, canonical] of [
    ["RIFT.svg", "Rift-AppIcon-Light.svg"],
    ["RIFT-mark.svg", "Rift-Symbol-Black.svg"],
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(root, iconRoots[0], native)),
      fs.readFileSync(path.join(root, "public/brand", canonical)),
    );
  }
});

test("native master icons use the approved package's warm light background", async () => {
  for (const directory of iconRoots) {
    const { data, info } = await sharp(path.join(root, directory, "icon.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel =
      (Math.floor(info.height * 0.1) * info.width +
        Math.floor(info.width * 0.5)) *
      4;
    assert.deepEqual(
      [...data.subarray(pixel, pixel + 4)],
      [243, 240, 232, 255],
      directory,
    );
  }
});

test("every native family matches its generated provenance and its legacy mirror", async () => {
  const manifestPath = path.join(root, iconRoots[0], "provenance.json");
  assert(
    fs.existsSync(manifestPath),
    "native icon provenance must be recorded",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.package, "RIFT-Logo-Package-11");
  assert.equal(
    manifest.sources["RIFT.svg"].sha256,
    "4262fbb686d91853a3923d80ec7b726d0c9c70fbb89f2f656f89e4042ff8d2ad",
  );
  assert.equal(
    manifest.sources["RIFT-mark.svg"].sha256,
    "75f8339b5524cd74d6534277630c887d2151b46d1a893d21ff725762abeef5ba",
  );
  for (const directory of iconRoots) {
    for (const [file, expected] of Object.entries({
      ...manifest.sources,
      ...manifest.files,
    })) {
      const bytes = fs.readFileSync(path.join(root, directory, file));
      assert.equal(hash(bytes), expected.sha256, `${directory}/${file}`);
      if (file.endsWith(".png")) {
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.width, expected.width, file);
        assert.equal(metadata.height, expected.height, file);
        assert.equal(
          metadata.width,
          expectedSize(file),
          `${file} matches its platform dimensions`,
        );
      }
    }
  }
  for (const required of [
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.icns",
    "icon.ico",
    "Square310x310Logo.png",
    "ios/AppIcon-512@2x.png",
    "android/mipmap-xxxhdpi/ic_launcher.png",
    "icon.iconset/icon_512x512@2x.png",
  ]) {
    assert(
      manifest.files[required],
      `${required} is part of the generated family`,
    );
  }
  const ico = fs.readFileSync(path.join(root, iconRoots[0], "icon.ico"));
  assert.equal(ico.readUInt16LE(2), 1);
  assert(ico.readUInt16LE(4) >= 2, "Windows icon retains multiple resolutions");
  const icns = fs.readFileSync(path.join(root, iconRoots[0], "icon.icns"));
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types = [];
  for (let offset = 8; offset < icns.length; ) {
    types.push(icns.toString("ascii", offset, offset + 4));
    offset += icns.readUInt32BE(offset + 4);
  }
  assert.deepEqual(
    types,
    [...types].sort(),
    "ICNS chunks have deterministic order",
  );
});
