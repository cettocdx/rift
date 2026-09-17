/**
 * Reading a built app out of its sandbox.
 *
 * A published site is a snapshot of static output, so publishing has to answer
 * two questions the preview never had to: which directory is the built app, and
 * which of its files are safe to serve. Both live here, separate from the route,
 * so they can be tested without a sandbox.
 */

/** Directories a web bundler writes its output to, in the order we prefer. */
export const BUILD_OUTPUT_DIRS = ["dist", "build", "out", "public"] as const;

/** Anything that would leak the project rather than serve the app. */
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".env",
  "node_modules",
  ".DS_Store",
]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
};

export function contentTypeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Whether a path inside the build output should be published.
 *
 * Bundlers happily copy whatever sits in the source `public/` directory, so a
 * stray `.env` reaching the output directory is an ordinary accident — and
 * publishing it would put it on the open web under the user's own domain.
 */
export function isPublishablePath(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith("/")) return false;
  // A path that climbs out of the output directory is never ours to publish.
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    return false;
  }
  return !segments.some(
    (segment) =>
      EXCLUDED_SEGMENTS.has(segment) ||
      segment.startsWith(".env") ||
      segment === ".git",
  );
}

/**
 * Shell that lists a build output directory's files, newline-separated and
 * relative to it. Kept here beside the rules it enforces.
 */
export function listBuildOutputCommand(outputDir: string): string {
  const quoted = shellQuote(outputDir);
  return `cd ${quoted} && find . -type f -not -path '*/.git/*' -not -name '.DS_Store' | sed 's|^\\./||' | sort`;
}

/** Single-quote a path for /bin/sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
