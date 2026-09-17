const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { prepareMonacoAssets } = require("../prepare-monaco-assets.cjs");

function fixture(t, version = "0.55.1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rift-monaco-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { "monaco-editor": version } }),
  );
  fs.symlinkSync(
    path.resolve(__dirname, "../../node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  return root;
}

function assertTreeMatches(source, destination) {
  assert.deepEqual(
    fs.readdirSync(destination).sort(),
    fs.readdirSync(source).sort(),
  );
  for (const name of fs.readdirSync(source)) {
    const original = path.join(source, name);
    const copy = path.join(destination, name);
    if (fs.statSync(original).isDirectory()) assertTreeMatches(original, copy);
    else
      assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(original), name);
  }
}

test("publishes the complete installed distribution, notices, and fonts without rewriting it on repeat", (t) => {
  const root = fixture(t);
  const source = path.dirname(require.resolve("monaco-editor/package.json"));
  const destination = prepareMonacoAssets(root);
  assert.equal(destination, path.join(root, "public/vendor/monaco/0.55.1"));
  assertTreeMatches(path.join(source, "min/vs"), path.join(destination, "vs"));
  for (const name of ["LICENSE", "ThirdPartyNotices.txt"]) {
    assert.deepEqual(
      fs.readFileSync(path.join(destination, name)),
      fs.readFileSync(path.join(source, name)),
    );
  }
  const before = fs.statSync(path.join(destination, "vs/loader.js")).mtimeMs;
  assert.equal(prepareMonacoAssets(root), destination);
  assert.equal(
    fs.statSync(path.join(destination, "vs/loader.js")).mtimeMs,
    before,
  );
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ["0.55.1"]);
});

test("fails before publishing when the installed package differs from the exact pin", (t) => {
  const root = fixture(t, "0.54.0");
  assert.throws(() => prepareMonacoAssets(root), /must match the exact/);
  assert.equal(fs.existsSync(path.join(root, "public")), false);
});
