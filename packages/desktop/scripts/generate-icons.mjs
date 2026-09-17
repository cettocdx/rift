#!/usr/bin/env node
// Regenerate every native icon from the exact approved SVG sources. No app build.
import sharp from "sharp";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDir, "../../..");
const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const cliVersion = require("@tauri-apps/cli/package.json").version;
const targets = ["packages/desktop/src-tauri/icons", "src-tauri/icons"];
const approved = {
  "RIFT.svg": {
    packagePath: "SVG/Rift-AppIcon-Light.svg",
    sha256: "4262fbb686d91853a3923d80ec7b726d0c9c70fbb89f2f656f89e4042ff8d2ad",
  },
  "RIFT-mark.svg": {
    packagePath: "SVG/Rift-Symbol-Black.svg",
    sha256: "75f8339b5524cd74d6534277630c887d2151b46d1a893d21ff725762abeef5ba",
  },
};
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// Tauri's ICNS encoder iterates some icon types in an unstable order. The
// container identifies each image by its type; sort chunks without re-encoding.
function stableIcns(buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "icns" ||
    buffer.readUInt32BE(4) !== buffer.length
  )
    throw new Error("Invalid ICNS container");
  const chunks = [];
  let cursor = 8;
  while (cursor < buffer.length) {
    if (cursor + 8 > buffer.length) throw new Error("Truncated ICNS chunk");
    const size = buffer.readUInt32BE(cursor + 4);
    if (size < 8 || cursor + size > buffer.length)
      throw new Error("Invalid ICNS chunk size");
    chunks.push(buffer.subarray(cursor, cursor + size));
    cursor += size;
  }
  chunks.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([buffer.subarray(0, 8), ...chunks]);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(name)));
    else files.push(name);
  }
  return files.sort();
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--check"))
    throw new Error("Usage: node generate-icons.mjs [--check]");
  const check = process.argv.includes("--check");
  const temp = await mkdtemp(join(tmpdir(), "rift-native-icons-"));
  try {
    const inputs = {};
    for (const [file, provenance] of Object.entries(approved)) {
      const bytes = await readFile(join(repositoryRoot, targets[0], file));
      if (sha256(bytes) !== provenance.sha256)
        throw new Error(
          `${file} differs from the approved Logo Package 11 source`,
        );
      inputs[file] = bytes;
      await writeFile(join(temp, file), bytes);
    }
    // Native adaptive launchers use the approved symbol on the approved tile color.
    await writeFile(
      join(temp, "manifest.json"),
      JSON.stringify({
        default: "RIFT.svg",
        bg_color: "#F3F0E8",
        android_fg: "RIFT-mark.svg",
        android_fg_scale: 85,
        android_monochrome: "RIFT-mark.svg",
      }),
    );
    const generated = join(temp, "icons");
    execFileSync(
      process.execPath,
      [cli, "icon", join(temp, "manifest.json"), "--output", generated],
      { stdio: "pipe" },
    );
    const icnsPath = join(generated, "icon.icns");
    await writeFile(icnsPath, stableIcns(await readFile(icnsPath)));
    // CLI 2.11.2 emits 49px legacy hdpi icons; Android hdpi requires 72px.
    // Downsample its corresponding largest outputs to retain launcher masking.
    for (const file of ["ic_launcher.png", "ic_launcher_round.png"]) {
      await sharp(join(generated, "android/mipmap-xxxhdpi", file))
        .resize(72, 72)
        .png()
        .toFile(join(generated, "android/mipmap-hdpi", file));
    }
    // Keep the source iconset family used by desktop tooling alongside the ICNS.
    const iconset = join(generated, "icon.iconset");
    await mkdir(iconset, { recursive: true });
    for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
      await sharp(inputs["RIFT.svg"], { density: 288 })
        .resize(size, size)
        .png()
        .toFile(join(iconset, `icon_${size}x${size}.png`));
      if (size <= 512)
        await sharp(inputs["RIFT.svg"], { density: 288 })
          .resize(size * 2, size * 2)
          .png()
          .toFile(join(iconset, `icon_${size}x${size}@2x.png`));
    }
    const outputs = new Map(Object.entries(inputs));
    const manifest = {
      package: "RIFT-Logo-Package-11",
      generator: {
        tauri: cliVersion,
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
      },
      sources: approved,
      files: {},
    };
    for (const file of await filesUnder(generated)) {
      const name = relative(generated, file).replaceAll("\\", "/");
      const bytes = await readFile(file);
      const details = { sha256: sha256(bytes) };
      if (name.endsWith(".png")) {
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || metadata.width !== metadata.height)
          throw new Error(`${name} is not a square native icon`);
        details.width = metadata.width;
        details.height = metadata.height;
      }
      manifest.files[name] = details;
      outputs.set(name, bytes);
    }
    outputs.set(
      "provenance.json",
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    );
    const differences = [];
    for (const target of targets) {
      const destination = join(repositoryRoot, target);
      // A newly introduced family must not silently leave old artwork behind.
      for (const existing of await filesUnder(destination)) {
        const name = relative(destination, existing).replaceAll("\\", "/");
        if (/\.(?:png|ico|icns|svg|xml)$/.test(name) && !outputs.has(name))
          throw new Error(`Unmanaged native icon: ${target}/${name}`);
      }
      for (const [name, bytes] of outputs) {
        const file = join(destination, name);
        if (check) {
          let existing;
          try {
            existing = await readFile(file);
          } catch {
            /* Missing files are mismatches. */
          }
          if (!existing?.equals(bytes)) differences.push(`${target}/${name}`);
        } else {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, bytes);
        }
      }
    }
    if (differences.length)
      throw new Error(
        `Native icons are stale. Run node packages/desktop/scripts/generate-icons.mjs\n${differences.join("\n")}`,
      );
    console.log(
      `${check ? "Verified" : "Generated"} ${outputs.size} native icon/source/provenance files in each of ${targets.length} roots from Logo Package 11.`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
