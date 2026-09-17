const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  resolveAppUrl,
  validateAppUrl,
  readGeneratedAppUrl,
  escapeScriptJson,
  canonicalMark,
  renderLaunchHtml,
} = require("./build");

const template = fs.readFileSync(
  path.join(__dirname, "launch.template.html"),
  "utf8",
);
const logo = fs.readFileSync(
  path.resolve(__dirname, "../../../public/brand/Rift-Symbol-Black.svg"),
  "utf8",
);
const fixture = {
  appUrl: "http://localhost:3020",
  template,
  css: ".rift-launch{background:#090a0c}",
  logo,
};

test("generates a self-contained launch document with the approved mark and system typography", () => {
  const html = renderLaunchHtml(fixture);
  assert.doesNotMatch(html, /@font-face|data:font|Space Grotesk/);
  assert.ok(html.includes(canonicalMark(logo)));
  assert.match(html, /Recursive Intelligence for Technology/);
  assert.equal(
    html.match(/<p[^>]*id="status-text"[^>]*>([\s\S]*?)<\/p>/)[1].trim(),
    "Opening RIFT",
  );
  assert.doesNotMatch(
    html,
    /<link\b|<script[^>]+src=|RIFT_LAUNCH_(STYLES|CONFIG|RUNTIME|MARK)/,
  );
  assert.equal(readGeneratedAppUrl(html), "http://localhost:3020/");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test("uses a deterministic production default and requires an explicit preview target", () => {
  assert.equal(resolveAppUrl({}), "https://riftsys.app/login");
  assert.equal(
    resolveAppUrl({ APP_URL: "http://localhost:3020" }),
    "http://localhost:3020/",
  );
  assert.throws(() => resolveAppUrl({ APP_URL: "" }), /non-empty/);
  const generated = renderLaunchHtml(fixture);
  assert.equal(readGeneratedAppUrl(generated), "http://localhost:3020/");
  assert.equal(
    readGeneratedAppUrl('const APP_URL = "http://localhost:3020";'),
    "http://localhost:3020/",
  );
  assert.equal(readGeneratedAppUrl("new template"), null);
  assert.throws(
    () =>
      readGeneratedAppUrl('<script id="rift-launch-config">invalid</script>'),
    /APP_URL explicitly/,
  );
});

test("validates app targets before generating or overwriting the launch page", () => {
  for (const value of [
    "",
    "not a URL",
    "javascript:alert(1)",
    "file:///tmp/app",
    "https://user:secret@riftsys.app",
    "http://remote.example",
  ]) {
    assert.throws(() => validateAppUrl(value), /APP_URL/);
  }
  for (const value of [
    "https://riftsys.app/login",
    "http://localhost:3020/",
    "http://127.0.0.1:3020/",
    "http://[::1]:3020/",
  ]) {
    assert.equal(validateAppUrl(value), value);
  }
});

test("keeps script-like URL/config content inert instead of breaking out of the document", () => {
  const encoded = escapeScriptJson({
    appUrl: '</script><script>alert("x")</script>&\u2028\u2029',
  });
  assert.doesNotMatch(encoded, /[<>&\u2028\u2029]/);
  assert.equal(
    JSON.parse(encoded).appUrl,
    '</script><script>alert("x")</script>&\u2028\u2029',
  );
  const html = renderLaunchHtml({
    ...fixture,
    appUrl: "https://riftsys.app/?next=</script><script>alert(1)</script>&a=2",
  });
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
});

test("fails loudly when shared mark, CSS, or template contracts change", () => {
  assert.throws(
    () => renderLaunchHtml({ ...fixture, logo: "<svg />" }),
    /canonical RIFT logo/,
  );
  assert.throws(
    () => renderLaunchHtml({ ...fixture, css: "</style><script>" }),
    /CSS/,
  );
  assert.throws(
    () => renderLaunchHtml({ ...fixture, template: "<html></html>" }),
    /template/,
  );
});

test("keeps nested placement and the second symbol's rotation in the approved SVG", () => {
  const approved =
    '<svg viewBox="0 0 124 124"><g transform="translate(12 12) scale(1)"><g fill="#000000"><path d="M55 7L91 39Z"/><path d="M55 7L91 39Z" transform="rotate(180 50 50)"/></g></g></svg>';
  const mark = canonicalMark(approved);
  assert.match(mark, /viewBox="0 0 124 124"/);
  assert.match(mark, /<g transform="translate\(12 12\) scale\(1\)">/);
  assert.match(
    mark,
    /<path d="M55 7L91 39Z" transform="rotate\(180 50 50\)"\/>/,
  );
  assert.equal((mark.match(/<path /g) || []).length, 2);
  assert.doesNotMatch(mark, /#000000/);
});

test("rejects active or unsupported markup in a launch mark", () => {
  for (const body of [
    '<script>alert(1)</script><path d="M0 0Z"/>',
    '<path d="M0 0Z" onclick="alert(1)"/>',
    '<path d="M0 0Z" transform="url(https://example.test)"/>',
  ])
    assert.throws(
      () => canonicalMark(`<svg viewBox="0 0 124 124">${body}</svg>`),
      /canonical RIFT logo/,
    );
});
