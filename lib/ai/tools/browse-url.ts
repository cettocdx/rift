import { tool } from "ai";
import { z } from "zod";

import type { ToolContext } from "@/types";
import { createSafeMcpFetch } from "@/lib/ai/mcp/mcp-url-policy";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  canonicalizeMcpUrl,
  classifyIpAddress,
  isExplicitLocalHostname,
} from "@/lib/ai/mcp/mcp-url-validation";

const BROWSER_NAVIGATION_TIMEOUT_MS = 25_000;
const BROWSER_SETTLE_TIMEOUT_MS = 1_200;
const MAX_BROWSER_REQUESTS = 80;
const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 30_000;
const MAX_LINKS = 40;
const MAX_URL_LENGTH = 4_096;

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
  "user-agent",
]);

const REMOVED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type BrowseUrlLink = {
  text: string;
  url: string;
};

export type BrowseUrlResult =
  | {
      ok: true;
      scope: "public-web" | "desktop-loopback";
      url: string;
      title: string;
      status: number | null;
      contentType: string | null;
      text: string;
      links: BrowseUrlLink[];
      network: {
        requests: number;
        blocked: number;
        bytes: number;
      };
    }
  | {
      ok: false;
      error: string;
      code:
        | "invalid-url"
        | "local-access-required"
        | "local-access-denied"
        | "navigation-failed"
        | "cancelled";
    };

type BrowserPageSnapshot = Extract<BrowseUrlResult, { ok: true }>;
type BrowserRenderer = (
  url: string,
  options: { signal?: AbortSignal },
) => Promise<BrowserPageSnapshot>;

export type DesktopLoopbackFetchResult = {
  status: number;
  finalUrl: string;
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
  bytes: number;
  truncated: boolean;
};

export type DesktopLoopbackFetcher = (
  url: string,
  options: { signal?: AbortSignal },
) => Promise<DesktopLoopbackFetchResult>;

export type BrowseUrlOptions = {
  renderer?: BrowserRenderer;
  desktopLoopbackFetch?: DesktopLoopbackFetcher;
};

type ResourceLoader = (
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}>;

function cleanUrlPolicyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll("MCP server", "Web target")
    .replaceAll("MCP", "Web");
}

function isExplicitNonPublicTarget(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl.trim());
    if (isExplicitLocalHostname(url.hostname)) return true;
    const classification = classifyIpAddress(url.hostname);
    return classification !== null && classification.kind !== "public";
  } catch {
    return false;
  }
}

function isExplicitLoopbackTarget(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl.trim());
    const hostname = url.hostname
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .toLowerCase();
    if (hostname === "localhost") return true;
    return classifyIpAddress(hostname)?.kind === "loopback";
  } catch {
    return false;
  }
}

/**
 * Browser navigation is intentionally public-web only. Localhost, RFC1918,
 * link-local, metadata, and other special-use targets must go through the
 * separate desktop grant/relay; a cloud worker must never interpret localhost
 * as the user's computer.
 */
export function validatePublicBrowseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new Error("Web target URL is empty or too long.");
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(
      "Web target URL cannot contain whitespace or control characters.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Web target URL is invalid.");
  }

  // Fragments are browser-local and never reach the network. Validate the
  // network URL without it, then restore the fragment for in-page navigation.
  const fragment = parsed.hash;
  parsed.hash = "";
  let canonical: string;
  try {
    canonical = canonicalizeMcpUrl(parsed.toString());
  } catch (error) {
    throw new Error(cleanUrlPolicyError(error));
  }

  const safe = new URL(canonical);
  safe.hash = fragment;
  return safe.toString();
}

export function validateDesktopLoopbackBrowseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new Error("Local web target URL is empty or too long.");
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(
      "Local web target URL cannot contain whitespace or control characters.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Local web target URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local web targets must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Local web target URL cannot contain credentials.");
  }
  if (!isExplicitLoopbackTarget(url.toString())) {
    throw new Error(
      "Desktop local access permits only localhost, 127/8, or ::1 URLs.",
    );
  }
  return url.toString();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return named[normalized] ?? match;
    },
  );
}

function htmlVisibleText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(?:br|hr)\s*\/?\s*>/gi, "\n")
      .replace(
        /<\/(?:article|aside|div|footer|h[1-6]|header|li|main|nav|p|section|tr)>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  );
}

function safeDesktopReturnedLink(rawUrl: string): string | null {
  try {
    if (isExplicitLoopbackTarget(rawUrl)) {
      return validateDesktopLoopbackBrowseUrl(rawUrl);
    }
    return validatePublicBrowseUrl(rawUrl);
  } catch {
    return null;
  }
}

export function summarizeDesktopLoopbackResponse(
  response: DesktopLoopbackFetchResult,
): BrowserPageSnapshot {
  const contentType = response.contentType.toLowerCase();
  const html = response.encoding === "utf8" && /html|xhtml/.test(contentType);
  const rawText =
    response.encoding === "utf8"
      ? response.body
      : `[Binary response omitted: ${response.contentType || "unknown content type"}, ${response.bytes} bytes]`;
  const titleMatch = html
    ? response.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    : null;
  const title = titleMatch
    ? normalizeVisibleText(decodeHtmlEntities(titleMatch[1])).slice(0, 500)
    : "";
  const text = normalizeVisibleText(html ? htmlVisibleText(rawText) : rawText);
  const links: BrowseUrlLink[] = [];

  if (html) {
    const seen = new Set<string>();
    const hrefPattern =
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (const match of response.body.matchAll(hrefPattern)) {
      const href = match[1] ?? match[2] ?? match[3];
      if (!href) continue;
      let absolute: string;
      try {
        absolute = new URL(
          decodeHtmlEntities(href),
          response.finalUrl,
        ).toString();
      } catch {
        continue;
      }
      const safeUrl = safeDesktopReturnedLink(absolute);
      if (!safeUrl || seen.has(safeUrl)) continue;
      seen.add(safeUrl);
      links.push({ text: safeUrl, url: safeUrl });
      if (links.length >= MAX_LINKS) break;
    }
  }

  return {
    ok: true,
    scope: "desktop-loopback",
    url: response.finalUrl,
    title,
    status: response.status,
    contentType: response.contentType || null,
    text: response.truncated ? `${text}\n\n[desktop response truncated]` : text,
    links,
    network: {
      requests: 1,
      blocked: 0,
      bytes: response.bytes,
    },
  };
}

function filteredRequestHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (FORWARDED_REQUEST_HEADERS.has(normalized)) {
      filtered[normalized] = value;
    }
  }
  // Avoid compressed response bodies: route.fulfill receives decoded bytes
  // and must never replay a stale Content-Encoding header.
  filtered["accept-encoding"] = "identity";
  return filtered;
}

function filteredResponseHeaders(headers: Headers): Record<string, string> {
  const filtered: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!REMOVED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      filtered[name] = value;
    }
  });
  return filtered;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Web resource exceeded the ${maxBytes}-byte limit.`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Web resource exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

/**
 * Every Chromium request is fulfilled through the already-audited pinned
 * transport. It resolves and classifies DNS before opening the socket and uses
 * manual redirects so Chromium's next hop is independently revalidated.
 */
export function createBrowserResourceLoader(
  safeFetch = createSafeMcpFetch({ maxRedirects: 0 }),
): ResourceLoader {
  return async (url, init) => {
    const method = init.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new Error(`Browser method ${method} is not allowed.`);
    }

    const response = await safeFetch(url, {
      method,
      headers: filteredRequestHeaders(init.headers ?? {}),
      redirect: "manual",
      signal: init.signal,
    });
    const body = await readBoundedBody(response, MAX_RESOURCE_BYTES);
    return {
      status: response.status,
      headers: filteredResponseHeaders(response.headers),
      body,
    };
  };
}

function normalizeVisibleText(value: string): string {
  const text = value
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[page text truncated]`;
}

function safeReturnedLink(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// The renderer needs Playwright's Chromium binary present in whatever runtime
// executes the tool. Some hosts ship the npm package but not the browser
// download, which used to surface to the agent as a hard "navigation-failed".
// Install it on demand (once, serialized) and retry so the first browse in a
// fresh runtime self-heals instead of erroring.
let chromiumInstall: Promise<void> | null = null;

function installChromiumOnce(): Promise<void> {
  if (chromiumInstall) return chromiumInstall;
  chromiumInstall = new Promise<void>((resolve, reject) => {
    let cli: string;
    try {
      // Anchor resolution at the project root so this works regardless of
      // whether the module compiled to ESM or CJS.
      const requireFromRoot = createRequire(
        path.join(process.cwd(), "package.json"),
      );
      cli = path.join(
        path.dirname(requireFromRoot.resolve("playwright/package.json")),
        "cli.js",
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      stdio: "ignore",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Chromium installation failed (exit ${code}).`)),
    );
  }).catch((error) => {
    // Allow a later navigation to retry the install rather than caching failure.
    chromiumInstall = null;
    throw error;
  });
  return chromiumInstall;
}

async function launchChromium(): Promise<import("playwright").Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !/Executable doesn't exist|playwright install|Failed to launch/i.test(
        message,
      )
    ) {
      throw error;
    }
    await installChromiumOnce();
    return chromium.launch({ headless: true });
  }
}

export const renderPublicBrowserPage: BrowserRenderer = async (
  url,
  { signal },
) => {
  const browser = await launchChromium();
  const context = await browser.newContext({
    acceptDownloads: false,
    javaScriptEnabled: true,
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const loadResource = createBrowserResourceLoader();
  let requestCount = 0;
  let blockedCount = 0;
  let totalBytes = 0;

  const abortReason = () =>
    signal?.reason instanceof Error
      ? signal.reason
      : new DOMException("Browser navigation was cancelled.", "AbortError");

  await context.routeWebSocket("**/*", async (socket) => {
    blockedCount += 1;
    await socket.close({ code: 1008, reason: "Read-only web session" });
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    const method = request.method().toUpperCase();
    const resourceType = request.resourceType();

    try {
      if (signal?.aborted) throw abortReason();
      requestCount += 1;
      if (requestCount > MAX_BROWSER_REQUESTS) {
        throw new Error("Browser request limit reached.");
      }
      if (["image", "media", "font"].includes(resourceType)) {
        blockedCount += 1;
        await route.abort("blockedbyclient");
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        blockedCount += 1;
        await route.abort("blockedbyclient");
        return;
      }

      const resource = await loadResource(requestUrl, {
        method,
        headers: request.headers(),
        signal,
      });
      totalBytes += resource.body.byteLength;
      if (totalBytes > MAX_PAGE_BYTES) {
        throw new Error("Browser page byte limit reached.");
      }
      await route.fulfill(resource);
    } catch {
      blockedCount += 1;
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  });

  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on(
    "download",
    (download) => void download.cancel().catch(() => undefined),
  );

  try {
    if (signal?.aborted) throw abortReason();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForTimeout(BROWSER_SETTLE_TIMEOUT_MS);
    if (signal?.aborted) throw abortReason();

    const snapshot = await page.evaluate((maxLinks) => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]"),
      )
        .map((anchor) => ({
          text: (anchor.innerText || anchor.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim(),
          url: anchor.href,
        }))
        .filter((link) => link.text || link.url)
        .slice(0, maxLinks * 3);
      return {
        title: document.title.trim(),
        text: document.body?.innerText ?? "",
        links,
      };
    }, MAX_LINKS);

    const links: BrowseUrlLink[] = [];
    const seenLinks = new Set<string>();
    for (const link of snapshot.links) {
      const safeUrl = safeReturnedLink(link.url);
      if (!safeUrl || seenLinks.has(safeUrl)) continue;
      seenLinks.add(safeUrl);
      links.push({ text: link.text.slice(0, 240), url: safeUrl });
      if (links.length >= MAX_LINKS) break;
    }

    return {
      ok: true,
      scope: "public-web",
      url: page.url(),
      title: snapshot.title.slice(0, 500),
      status: response?.status() ?? null,
      contentType: response?.headers()["content-type"] ?? null,
      text: normalizeVisibleText(snapshot.text),
      links,
      network: {
        requests: requestCount,
        blocked: blockedCount,
        bytes: totalBytes,
      },
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

export const createBrowseUrl = (
  context: ToolContext,
  {
    renderer = renderPublicBrowserPage,
    desktopLoopbackFetch,
  }: BrowseUrlOptions = {},
) =>
  tool({
    description: `Open and read a webpage through a bounded, read-only browser.

Public HTTPS pages render in an isolated, ephemeral Chromium profile. An explicit localhost/127/8/::1 URL can be fetched only through an online RIFT Desktop session with local access available for the signed-in owner. Use this when the user gives a URL, when current documentation must be inspected, or when you need to follow one of the returned links. The result includes page text and a bounded list of links.

Security boundary: this tool is read-only. Public browsing permits only GET/HEAD over public HTTPS, uses no personal cookies or Chrome profile, revalidates every redirect and subresource, and blocks private/link-local/metadata addresses, WebSockets, downloads, forms, and other state-changing requests. Desktop loopback fetches are owner-checked, localhost-only, response-capped, and available only while the owner-checked desktop session is online. It never attaches to or reads the user's personal Chrome profile.`,
    inputSchema: z.object({
      url: z
        .string()
        .describe(
          "Public HTTPS URL, or an explicit localhost/127/8/::1 URL when RIFT Desktop access is approved.",
        ),
      brief: z
        .string()
        .describe("One short sentence describing why this page is being read."),
    }),
    execute: async ({ url }, { abortSignal }): Promise<BrowseUrlResult> => {
      if (context.purpose !== "app" && context.purpose !== "security") {
        return {
          ok: false,
          code: "invalid-url",
          error:
            "The isolated browser is available only in Build and Hack Workbench.",
        };
      }

      const loopbackTarget = isExplicitLoopbackTarget(url);
      let safeUrl: string;
      try {
        safeUrl = loopbackTarget
          ? validateDesktopLoopbackBrowseUrl(url)
          : validatePublicBrowseUrl(url);
      } catch (error) {
        const message = cleanUrlPolicyError(error);
        const localTarget =
          isExplicitNonPublicTarget(url) ||
          /localhost|loopback|private|link-local|reserved/i.test(message);
        return {
          ok: false,
          code: localTarget ? "local-access-required" : "invalid-url",
          error: localTarget
            ? "This target is not public. RIFT Desktop local access currently supports only explicitly approved localhost/127/8/::1 pages."
            : message,
        };
      }

      if (loopbackTarget && !desktopLoopbackFetch) {
        return {
          ok: false,
          code: "local-access-required",
          error:
            "Start RIFT Desktop and grant local web access to open this localhost page. The cloud browser will not resolve it locally.",
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Browser navigation timed out.")),
        BROWSER_NAVIGATION_TIMEOUT_MS + 5_000,
      );
      const onAbort = () => controller.abort(abortSignal?.reason);
      abortSignal?.addEventListener("abort", onAbort, { once: true });

      try {
        if (loopbackTarget && desktopLoopbackFetch) {
          const response = await desktopLoopbackFetch(safeUrl, {
            signal: controller.signal,
          });
          return summarizeDesktopLoopbackResponse(response);
        }
        return await renderer(safeUrl, { signal: controller.signal });
      } catch (error) {
        const relayCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : undefined;
        const aborted = controller.signal.aborted || relayCode === "aborted";
        const denied = relayCode === "denied";
        const unavailable = relayCode === "unavailable";
        const relayFailure =
          relayCode === "timeout" ||
          relayCode === "disconnected" ||
          relayCode === "invalid_response";
        return {
          ok: false,
          code: aborted
            ? "cancelled"
            : denied
              ? "local-access-denied"
              : unavailable
                ? "local-access-required"
                : "navigation-failed",
          error: aborted
            ? "Browser navigation was cancelled or timed out."
            : denied
              ? "RIFT Desktop denied the localhost read. Enable Local websites in Settings → Workbench & terminal → This Mac in the desktop app, then retry. No folder sharing is required."
              : unavailable
                ? "Open RIFT Desktop with this account and connect Local websites in Settings → Workbench & terminal → This Mac. A browser tab alone cannot reach the Mac’s localhost."
                : relayFailure
                  ? "RIFT Desktop could not complete the localhost read. Reconnect the desktop local-access session and try again."
                  : `Could not read the page: ${cleanUrlPolicyError(error)}`,
        };
      } finally {
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", onAbort);
      }
    },
  });
