#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Keep the complete distribution: workers, language services, CSS, and fonts
// resolve relative to vs. No network access is needed to prepare or use it.
function prepareMonacoAssets(root = path.resolve(__dirname, "..")) {
  const version = require(path.join(root, "package.json")).dependencies[
    "monaco-editor"
  ];
  const packagePath = require.resolve("monaco-editor/package.json", {
    paths: [root],
  });
  const installed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (installed.version !== version) {
    throw new Error(
      `Monaco must match the exact package.json pin (${version}); installed ${installed.version}. Run pnpm install.`,
    );
  }
  const source = path.dirname(packagePath);
  const destination = path.join(root, "public", "vendor", "monaco", version);
  if (fs.existsSync(path.join(destination, ".complete"))) return destination;

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(temporary);
    fs.cpSync(path.join(source, "min", "vs"), path.join(temporary, "vs"), {
      recursive: true,
    });
    for (const name of ["LICENSE", "ThirdPartyNotices.txt"]) {
      fs.copyFileSync(path.join(source, name), path.join(temporary, name));
    }
    fs.writeFileSync(path.join(temporary, ".complete"), `${version}\n`);
    try {
      fs.renameSync(temporary, destination);
    } catch (error) {
      // Another dev/build process may have published this same immutable version.
      if (!fs.existsSync(path.join(destination, ".complete"))) throw error;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return destination;
}

module.exports = { prepareMonacoAssets };
if (require.main === module) console.log(prepareMonacoAssets());
