import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CATALOG_PATH = path.join(REPO_ROOT, "app/components/mcpCatalog.tsx");
const OUTPUT_DIR = path.join(REPO_ROOT, "public/plugin-logos");

const SOURCES = {
  logos: "https://cdn.jsdelivr.net/npm/@iconify-json/logos@1.2.11/icons.json",
  simple:
    "https://cdn.jsdelivr.net/npm/simple-icons@16.27.0/data/simple-icons.json",
};

const SOURCE_ALIASES = new Map([
  ["replicate-flux", ["logos", "flux"]],
  ["bigquery", ["simple", "googlebigquery"]],
  ["front", ["logos", "frontapp"]],
  ["brave-search", ["logos", "brave"]],
  ["zoho-crm", ["logos", "zoho"]],
  ["onedrive", ["logos", "microsoft-onedrive"]],
  ["hashicorp-vault", ["logos", "vault-icon"]],
  ["x-twitter", ["simple", "x"]],
]);

const RASTER_SOURCE_OVERRIDES = new Map([
  [
    "height",
    "https://store-app-images.s3.us-east-1.amazonaws.com/4c2fb13f390f64c84fbea3a070b4014a-300x300.png",
  ],
]);

function normalize(value) {
  return value
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]/g, "");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  return response.json();
}

async function loadCatalog() {
  const source = await readFile(CATALOG_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: CATALOG_PATH,
  }).outputText;
  const catalogModule = { exports: {} };
  const evaluate = new Function("require", "module", "exports", compiled);
  evaluate(
    () => {
      throw new Error("The MCP catalog must stay dependency-free.");
    },
    catalogModule,
    catalogModule.exports,
  );
  return catalogModule.exports.MCP_CATALOG;
}

function iconifySvg(entry, icon, collection) {
  const width = icon.width ?? collection.width ?? 256;
  const height = icon.height ?? collection.height ?? 256;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${escapeXml(entry.name)} logo</title>`,
    icon.body,
    "</svg>\n",
  ].join("");
}

async function simpleIconSvg(entry, icon) {
  const sourceUrl = `https://cdn.jsdelivr.net/npm/simple-icons@16.27.0/icons/${icon.slug}.svg`;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${entry.name} logo: ${response.status}`);
  }
  const source = await response.text();
  return source
    .replace("<svg ", `<svg fill="#${icon.hex}" `)
    .replace(
      /<title>.*?<\/title>/,
      `<title>${escapeXml(entry.name)} logo</title>`,
    )
    .replace(/\s*$/, "\n");
}

async function providerFaviconSvg(entry) {
  const providerUrl = `https://${entry.domain}`;
  const sourceUrl =
    RASTER_SOURCE_OVERRIDES.get(entry.id) ??
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(providerUrl)}&sz=128`;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${entry.name} logo: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const responseMime = response.headers.get("content-type")?.split(";")[0];
  const mime =
    responseMime?.startsWith("image/") === true
      ? responseMime
      : bytes.subarray(1, 4).toString("ascii") === "PNG"
        ? "image/png"
        : "image/png";
  const digest = createHash("sha256").update(bytes).digest("hex");
  const body = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">',
    `<title>${escapeXml(entry.name)} logo</title>`,
    `<image width="128" height="128" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${bytes.toString("base64")}"/>`,
    "</svg>\n",
  ].join("");
  return { body, digest, sourceUrl };
}

const [catalog, logosCollection, simpleIcons] = await Promise.all([
  loadCatalog(),
  fetchJson(SOURCES.logos),
  fetchJson(SOURCES.simple),
]);

const logosByName = new Map();
for (const slug of Object.keys(logosCollection.icons)) {
  for (const candidate of [slug, slug.replace(/-?(icon|logo|official)$/, "")]) {
    if (!logosByName.has(normalize(candidate))) {
      logosByName.set(normalize(candidate), slug);
    }
  }
}

const simpleByName = new Map();
const simpleBySlug = new Map();
for (const icon of simpleIcons) {
  simpleByName.set(normalize(icon.title), icon);
  simpleByName.set(normalize(icon.slug), icon);
  simpleBySlug.set(icon.slug, icon);
}

await mkdir(OUTPUT_DIR, { recursive: true });

const manifest = {};
const fallbackDigests = new Map();
const stats = { logos: 0, simple: 0, favicon: 0 };

await Promise.all(
  catalog.map(async (entry) => {
    const alias = SOURCE_ALIASES.get(entry.id);
    const logoSlug =
      alias?.[0] === "logos"
        ? alias[1]
        : logosByName.get(normalize(entry.name));
    const preferredLogoSlug = logosCollection.icons[`${logoSlug}-icon`]
      ? `${logoSlug}-icon`
      : logoSlug;
    const simpleIcon =
      alias?.[0] === "simple"
        ? simpleBySlug.get(alias[1])
        : simpleByName.get(normalize(entry.name));

    let body;
    let source;
    let sourceUrl;

    if (preferredLogoSlug && logosCollection.icons[preferredLogoSlug]) {
      body = iconifySvg(
        entry,
        logosCollection.icons[preferredLogoSlug],
        logosCollection,
      );
      source = "Iconify Logos";
      sourceUrl = `https://icon-sets.iconify.design/logos/${preferredLogoSlug}/`;
      stats.logos += 1;
    } else if (simpleIcon) {
      body = await simpleIconSvg(entry, simpleIcon);
      source = "Simple Icons";
      sourceUrl = `https://simpleicons.org/?q=${encodeURIComponent(simpleIcon.title)}`;
      stats.simple += 1;
    } else {
      const fallback = await providerFaviconSvg(entry);
      body = fallback.body;
      source = "Provider favicon";
      sourceUrl = fallback.sourceUrl;
      const duplicate = fallbackDigests.get(fallback.digest);
      if (duplicate && duplicate.domain !== entry.domain) {
        throw new Error(
          `Provider logo fallback repeated for ${duplicate.name} and ${entry.name}.`,
        );
      }
      fallbackDigests.set(fallback.digest, entry);
      stats.favicon += 1;
    }

    const filename = `${entry.id}.svg`;
    await writeFile(path.join(OUTPUT_DIR, filename), body, "utf8");
    manifest[entry.id] = {
      name: entry.name,
      path: `/plugin-logos/${filename}`,
      source,
      sourceUrl,
    };
  }),
);

await writeFile(
  path.join(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  `Synced ${catalog.length} plugin logos (${stats.logos} Iconify, ${stats.simple} Simple Icons, ${stats.favicon} provider favicons).`,
);
