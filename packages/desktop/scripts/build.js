#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { startLaunch } = require("./boot-runtime");

const desktopRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopRoot, "../..");
const destination = path.join(desktopRoot, "src/index.html");
const PRODUCTION_APP_URL = "https://riftsys.app/login";

function validateAppUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("APP_URL must be a non-empty absolute HTTP(S) URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "APP_URL must use HTTP(S) and must not contain credentials.",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new Error("Unencrypted APP_URL is only supported on localhost.");
  }
  return url.href;
}

function readGeneratedAppUrl(html) {
  const config = html.match(
    /<script[^>]*id="rift-launch-config"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (config) {
    try {
      return validateAppUrl(JSON.parse(config[1]).appUrl);
    } catch {
      throw new Error(
        "The generated launch configuration is invalid; pass APP_URL explicitly.",
      );
    }
  }
  // Migrate the earlier generated loader once, retaining its chosen target.
  const legacy = html.match(/const APP_URL = ("(?:[^"\\]|\\.)*");/);
  return legacy ? validateAppUrl(JSON.parse(legacy[1])) : null;
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function canonicalMark(source) {
  const invalid = () => {
    throw new Error(
      "The canonical RIFT logo must expose a static SVG with paths and transforms.",
    );
  };
  const svg = source.trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  const viewBox = svg?.[1].match(/viewBox="([0-9.\s-]+)"/)?.[1];
  if (!viewBox) return invalid();
  const body = svg[2];
  let cursor = 0,
    groups = 0,
    paths = 0;
  const output = [];
  for (const token of body.matchAll(/<\/g\s*>|<g\b[^>]*>|<path\b[^>]*\/>/g)) {
    if (body.slice(cursor, token.index).trim()) return invalid();
    cursor = token.index + token[0].length;
    if (/^<\/g/.test(token[0])) {
      if (--groups < 0) return invalid();
      output.push("</g>");
      continue;
    }
    const isPath = token[0].startsWith("<path");
    const attributes = token[0].slice(isPath ? 5 : 2, isPath ? -2 : -1);
    const seen = new Set();
    let offset = 0;
    const normalized = [];
    for (const attribute of attributes.matchAll(/([a-z]+)="([^"]*)"/g)) {
      if (attributes.slice(offset, attribute.index).trim()) return invalid();
      offset = attribute.index + attribute[0].length;
      const [, name, value] = attribute;
      if (seen.has(name)) return invalid();
      seen.add(name);
      if (name === "d" && isPath && /^[a-zA-Z0-9.,+\-\s]+$/.test(value)) {
        normalized.push(`d="${value}"`);
      } else if (
        name === "transform" &&
        /^(?:(?:translate|scale|rotate)\([0-9.,+\-\s]+\)\s*)+$/.test(value)
      ) {
        normalized.push(`transform="${value}"`);
      } else if (
        name === "fill" &&
        /^(?:#[0-9a-fA-F]{6}|currentColor)$/.test(value)
      ) {
        normalized.push('fill="currentColor"');
      } else return invalid();
    }
    if (attributes.slice(offset).trim() || (isPath && !seen.has("d")))
      return invalid();
    if (isPath) paths++;
    else groups++;
    output.push(
      `<${isPath ? "path" : "g"}${normalized.length ? " " + normalized.join(" ") : ""}${isPath ? "/>" : ">"}`,
    );
  }
  if (body.slice(cursor).trim() || groups || !paths) return invalid();
  return `<svg class="rift-launch__mark" viewBox="${viewBox}" fill="currentColor" shape-rendering="geometricPrecision" aria-hidden="true" focusable="false">${output.join("")}</svg>`;
}

function renderLaunchHtml({ appUrl, template, css, logo }) {
  const normalizedUrl = validateAppUrl(appUrl);
  if (/<\/style/i.test(css))
    throw new Error("Launch CSS cannot close its style element.");
  const nativeBase =
    "html,body{margin:0;width:100%;min-height:100%;background:transparent}body{overflow:hidden}[hidden]{display:none!important}\n";
  const replacements = {
    "/* RIFT_LAUNCH_STYLES */": nativeBase + css,
    "<!-- RIFT_LAUNCH_MARK -->": canonicalMark(logo),
    "/* RIFT_LAUNCH_CONFIG */": escapeScriptJson({ appUrl: normalizedUrl }),
    "/* RIFT_LAUNCH_RUNTIME */": `(${startLaunch.toString()})(window, JSON.parse(document.getElementById("rift-launch-config").textContent).appUrl);`,
  };
  let html = template;
  for (const [marker, replacement] of Object.entries(replacements)) {
    if (html.split(marker).length !== 2)
      throw new Error(`Launch template must contain one ${marker} marker.`);
    html = html.replace(marker, () => replacement);
  }
  return html;
}

function resolveAppUrl(environment = process.env) {
  return validateAppUrl(environment.APP_URL ?? PRODUCTION_APP_URL);
}

function build() {
  const appUrl = resolveAppUrl();
  const html = renderLaunchHtml({
    appUrl,
    template: fs.readFileSync(
      path.join(__dirname, "launch.template.html"),
      "utf8",
    ),
    css: fs.readFileSync(
      path.join(repositoryRoot, "components/launch/launch-screen.css"),
      "utf8",
    ),
    logo: fs.readFileSync(
      path.join(repositoryRoot, "public/brand/Rift-Symbol-Black.svg"),
      "utf8",
    ),
  });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, html);
  console.log(`Built offline RIFT launch screen for ${new URL(appUrl).origin}`);
}

if (require.main === module) build();
module.exports = {
  resolveAppUrl,
  validateAppUrl,
  readGeneratedAppUrl,
  escapeScriptJson,
  canonicalMark,
  renderLaunchHtml,
};
