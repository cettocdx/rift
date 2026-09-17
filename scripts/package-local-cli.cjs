#!/usr/bin/env node
// Build the downloadable runner from source without replacing a live runner's dist.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const localPackage = path.join(root, "packages/local");
const downloadDirectory = path.join(root, "public/downloads");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function sourceFiles(directory, prefix = "") {
  return fs
    .readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .filter((entry) => entry.name !== "__tests__")
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) return sourceFiles(directory, relative);
      if (entry.isSymbolicLink())
        throw new Error(`Package inputs cannot be symlinks: ${relative}`);
      return [relative];
    })
    .sort();
}
function inputs(packageDirectory) {
  return [
    ...["package.json", "tsconfig.json", "README.md", "pnpm-lock.yaml"].map(
      (name) => [name, path.join(packageDirectory, name)],
    ),
    ...sourceFiles(path.join(packageDirectory, "src")).map((name) => [
      `src/${name}`,
      path.join(packageDirectory, "src", name),
    ]),
    ["LICENSE", path.join(root, "LICENSE")],
    ["workspace/pnpm-lock.yaml", path.join(root, "pnpm-lock.yaml")],
    ["workspace/pnpm-workspace.yaml", path.join(root, "pnpm-workspace.yaml")],
    ["packaging-script", __filename],
  ];
}
function sourceDigest(packageDirectory = localPackage) {
  const hash = createHash("sha256");
  for (const [name, file] of inputs(packageDirectory))
    hash.update(`${name}\0`).update(fs.readFileSync(file)).update("\0");
  return hash.digest("hex");
}
function replaceFile(target, content) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
function buildLocalCli({
  packageDirectory = localPackage,
  outputDirectory = downloadDirectory,
  check = false,
  distOnly = false,
} = {}) {
  if (check && distOnly)
    throw new Error("--check and --dist-only cannot be combined.");
  const inputDigest = sourceDigest(packageDirectory);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rift-cli-package-"));
  const stage = path.join(temporary, "package");
  fs.mkdirSync(stage);
  try {
    // Never copy ignored dist or workspace dependencies into the archive.
    for (const [name, file] of inputs(packageDirectory)) {
      if (
        name === "packaging-script" ||
        name === "pnpm-lock.yaml" ||
        name.startsWith("workspace/")
      )
        continue;
      const target = path.join(stage, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
    fs.symlinkSync(
      path.join(packageDirectory, "node_modules"),
      path.join(stage, "node_modules"),
      "junction",
    );
    const compiler = require.resolve("typescript/bin/tsc", {
      paths: [packageDirectory],
    });
    execFileSync(
      process.execPath,
      [compiler, "--project", path.join(stage, "tsconfig.json")],
      { cwd: stage, stdio: "pipe" },
    );
    const runtimeFiles = sourceFiles(path.join(stage, "src"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
      .map((name) => `dist/${name.replace(/\.ts$/, ".js")}`);
    for (const file of runtimeFiles)
      if (!fs.existsSync(path.join(stage, file)))
        throw new Error(`Compiler did not emit ${file}`);
    if (sourceDigest(packageDirectory) !== inputDigest)
      throw new Error(
        "Package source changed during compilation; retry the build.",
      );
    if (distOnly) {
      // Explicit npm pack/prepack rebuilds the package's dist. Web builds use
      // the isolated archive path above and never alter the running receiver.
      fs.rmSync(path.join(packageDirectory, "dist"), {
        recursive: true,
        force: true,
      });
      fs.cpSync(path.join(stage, "dist"), path.join(packageDirectory, "dist"), {
        recursive: true,
      });
      return { runtimeFiles };
    }
    const [packed] = JSON.parse(
      execFileSync(
        npm,
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        {
          cwd: stage,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    const entries = packed.files.map((file) => file.path).sort();
    for (const file of runtimeFiles)
      if (!entries.includes(file))
        throw new Error(`Archive is missing ${file}`);
    if (
      entries.some(
        (file) =>
          file.startsWith("node_modules/") ||
          file.startsWith("src/") ||
          file.includes("__tests__"),
      )
    )
      throw new Error("Archive contains workspace-only files");
    const archive = fs.readFileSync(path.join(temporary, packed.filename));
    if (sourceDigest(packageDirectory) !== inputDigest)
      throw new Error(
        "Package source changed during compilation; retry the build.",
      );
    const pkg = JSON.parse(
      fs.readFileSync(path.join(stage, "package.json"), "utf8"),
    );
    const manifest = {
      schemaVersion: 1,
      name: pkg.name,
      version: pkg.version,
      archive: "rift-cli.tgz",
      archiveSha256: sha256(archive),
      sourceSha256: inputDigest,
      sourceInputs: inputs(packageDirectory).map(([name]) => name),
      typescriptVersion: require(
        require.resolve("typescript/package.json", {
          paths: [packageDirectory],
        }),
      ).version,
      nodeVersion: process.version,
      npmVersion: execFileSync(npm, ["--version"], { encoding: "utf8" }).trim(),
      runtimeFiles,
      files: entries,
    };
    const destination = path.join(outputDirectory, manifest.archive);
    const manifestPath = path.join(outputDirectory, "rift-cli.manifest.json");
    if (check) {
      const recorded = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (
        sha256(fs.readFileSync(destination)) !== manifest.archiveSha256 ||
        recorded.archiveSha256 !== manifest.archiveSha256 ||
        recorded.sourceSha256 !== manifest.sourceSha256
      )
        throw new Error(
          "Local CLI download is stale. Run pnpm local-sandbox:package.",
        );
    } else {
      fs.mkdirSync(outputDirectory, { recursive: true });
      replaceFile(destination, archive);
      replaceFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return manifest;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { buildLocalCli, sourceDigest, sourceFiles, sha256 };
if (require.main === module) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some((flag) => !["--check", "--dist-only"].includes(flag)))
      throw new Error(
        "Use --check or --dist-only, or no flags to build the download.",
      );
    const result = buildLocalCli({
      check: flags.includes("--check"),
      distOnly: flags.includes("--dist-only"),
    });
    console.log(
      `Local CLI ${flags.includes("--check") ? "verified" : "built"}: ${result.archiveSha256 || result.runtimeFiles.length + " runtime modules"}`,
    );
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    console.error(error.message);
    process.exitCode = 1;
  }
}
