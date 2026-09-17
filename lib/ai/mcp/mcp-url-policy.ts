import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import {
  canonicalizeMcpUrl,
  classifyIpAddress,
  isExplicitLocalHostname,
  type McpUrlValidationOptions,
} from "./mcp-url-validation";

const DEFAULT_MAX_REDIRECTS = 4;
const MAX_BUFFERED_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES = 8 * 1024 * 1024;
const BUFFERED_RESPONSE_IDLE_TIMEOUT_MS = 30_000;
const BUFFERED_RESPONSE_OVERALL_TIMEOUT_MS = 120_000;
const SSE_IDLE_TIMEOUT_MS = 5 * 60_000;

const ALWAYS_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "mcp-session-id",
  "proxy-authorization",
]);

const FORBIDDEN_CONFIGURED_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const CROSS_ORIGIN_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "pragma",
  "user-agent",
]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedMcpTarget extends ResolvedAddress {
  url: URL;
}

export type McpHostnameResolver = (
  hostname: string,
) => Promise<ReadonlyArray<ResolvedAddress>>;

export interface ResolvedMcpRequest {
  url: URL;
  init: RequestInit;
  address: string;
  family: 4 | 6;
}

export type ResolvedMcpDispatcher = (
  request: ResolvedMcpRequest,
) => Promise<Response>;

export interface SafeMcpFetchOptions extends McpUrlValidationOptions {
  /** Headers configured for this server. All are stripped across origins. */
  baseHeaders?: HeadersInit;
  /** Origin that is allowed to receive baseHeaders. Required when they exist. */
  configuredUrl?: string | URL;
  maxRedirects?: number;
  /** Dependency injection points used by adversarial unit tests. */
  resolveHostname?: McpHostnameResolver;
  dispatch?: ResolvedMcpDispatcher;
}

type McpFetchInput = string | URL | Request;
export type McpFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface McpResponseStreamGuardOptions {
  isEventStream: boolean;
  maxResponseBytes?: number;
  maxEventBytes?: number;
  idleTimeoutMs?: number;
  overallTimeoutMs?: number;
  abort?: (reason: Error) => void;
}

export class McpResponsePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpResponsePolicyError";
  }
}

function unwrappedHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

export function isLocalMcpDevelopmentEnabled(
  env: {
    MCP_ALLOW_INSECURE_LOCALHOST?: string;
    NODE_ENV?: string;
  } = process.env,
): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.MCP_ALLOW_INSECURE_LOCALHOST === "true"
  );
}

const defaultResolver: McpHostnameResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

/**
 * Resolve and validate every address returned for a host. Rejecting a mixed
 * public/private answer set prevents choosing a public answer while leaving a
 * rebinding/private answer available to another resolver.
 */
export async function resolveSafeMcpTarget(
  rawUrl: string | URL,
  options: McpUrlValidationOptions & {
    resolveHostname?: McpHostnameResolver;
  } = {},
): Promise<ResolvedMcpTarget> {
  const canonical = canonicalizeMcpUrl(rawUrl.toString(), options);
  const url = new URL(canonical);
  const hostname = unwrappedHostname(url);
  const literal = classifyIpAddress(hostname);

  if (literal) {
    return { url, address: hostname, family: literal.version };
  }

  const resolver = options.resolveHostname ?? defaultResolver;
  let answers: ReadonlyArray<ResolvedAddress>;
  try {
    answers = await resolver(hostname);
  } catch {
    throw new Error("MCP server hostname could not be resolved safely.");
  }
  if (answers.length === 0) {
    throw new Error("MCP server hostname returned no network addresses.");
  }

  const explicitLocal = isExplicitLocalHostname(url.hostname);
  const allowLocal =
    options.allowLocalDevelopment === true && explicitLocal === true;

  for (const answer of answers) {
    const classification = classifyIpAddress(answer.address);
    if (!classification || classification.version !== answer.family) {
      throw new Error("MCP server DNS returned an invalid IP address.");
    }

    const permittedLoopback = allowLocal && classification.kind === "loopback";
    if (classification.kind !== "public" && !permittedLoopback) {
      throw new Error(
        `MCP server DNS resolved to a blocked ${classification.kind} address.`,
      );
    }
    if (explicitLocal && classification.kind !== "loopback") {
      throw new Error("A local MCP hostname must resolve only to loopback.");
    }
  }

  const selected = answers[0];
  return {
    url,
    address: selected.address,
    family: selected.family,
  };
}

/** A Node lookup callback that can return only the previously vetted address. */
export function createPinnedLookup(
  address: string,
  family: 4 | 6,
): LookupFunction {
  return (_hostname, options, callback) => {
    queueMicrotask(() => {
      if (options.all) {
        callback(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    });
  };
}

function abortError(signal?: AbortSignal | null): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The MCP request was aborted.", "AbortError");
}

function asError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

/**
 * Bound untrusted MCP response streams without imposing a lifetime byte cap on
 * long-lived SSE connections. Buffered JSON/HTTP responses get a total byte
 * and overall-time budget; SSE gets a per-event budget and a generous idle
 * deadline that heartbeats or normal events continuously refresh.
 */
export function guardMcpResponseStream(
  source: ReadableStream<Uint8Array>,
  options: McpResponseStreamGuardOptions,
): ReadableStream<Uint8Array> {
  const maxResponseBytes =
    options.maxResponseBytes ?? MAX_BUFFERED_RESPONSE_BYTES;
  const maxEventBytes = options.maxEventBytes ?? MAX_SSE_EVENT_BYTES;
  const idleTimeoutMs =
    options.idleTimeoutMs ??
    (options.isEventStream
      ? SSE_IDLE_TIMEOUT_MS
      : BUFFERED_RESPONSE_IDLE_TIMEOUT_MS);
  const overallTimeoutMs =
    options.overallTimeoutMs ?? BUFFERED_RESPONSE_OVERALL_TIMEOUT_MS;

  for (const [name, value] of [
    ["response byte limit", maxResponseBytes],
    ["SSE event byte limit", maxEventBytes],
    ["idle timeout", idleTimeoutMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`MCP ${name} must be a positive finite number.`);
    }
  }
  if (
    !options.isEventStream &&
    (!Number.isFinite(overallTimeoutMs) || overallTimeoutMs <= 0)
  ) {
    throw new Error("MCP overall timeout must be a positive finite number.");
  }

  const reader = source.getReader();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let totalBytes = 0;
  let currentEventBytes = 0;
  let currentLineHasContent = false;
  let skipLfAfterCr = false;

  const clearTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (overallTimer) clearTimeout(overallTimer);
    idleTimer = undefined;
    overallTimer = undefined;
  };

  const fail = (error: Error) => {
    if (finished) return;
    finished = true;
    clearTimers();
    try {
      options.abort?.(error);
    } catch {
      // The Web stream still needs to surface the policy error even if socket
      // cleanup itself has already failed.
    }
    void reader.cancel(error).catch(() => undefined);
    controllerRef?.error(error);
  };

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      fail(
        new McpResponsePolicyError(
          `MCP response was idle for more than ${idleTimeoutMs}ms.`,
        ),
      );
    }, idleTimeoutMs);
  };

  const enforceBudget = (chunk: Uint8Array) => {
    if (!options.isEventStream) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxResponseBytes) {
        throw new McpResponsePolicyError(
          `MCP response exceeded the ${maxResponseBytes}-byte limit.`,
        );
      }
      return;
    }

    // SSE events end at a blank line. Count raw bytes without buffering event
    // contents, and support LF, CRLF, and lone-CR line endings across chunks.
    for (const byte of chunk) {
      currentEventBytes += 1;
      if (currentEventBytes > maxEventBytes) {
        throw new McpResponsePolicyError(
          `MCP SSE event exceeded the ${maxEventBytes}-byte limit.`,
        );
      }

      if (skipLfAfterCr) {
        skipLfAfterCr = false;
        if (byte === 0x0a) continue;
      }

      if (byte === 0x0d || byte === 0x0a) {
        const isBlankLine = !currentLineHasContent;
        currentLineHasContent = false;
        skipLfAfterCr = byte === 0x0d;
        if (isBlankLine) currentEventBytes = 0;
      } else {
        currentLineHasContent = true;
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      resetIdleTimer();
      if (!options.isEventStream) {
        overallTimer = setTimeout(() => {
          fail(
            new McpResponsePolicyError(
              `MCP response exceeded the ${overallTimeoutMs}ms overall deadline.`,
            ),
          );
        }, overallTimeoutMs);
      }
    },
    async pull(controller) {
      if (finished) return;
      try {
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          finished = true;
          clearTimers();
          controller.close();
          return;
        }

        const chunk = result.value;
        enforceBudget(chunk);
        resetIdleTimer();
        controller.enqueue(chunk);
      } catch (error) {
        fail(asError(error, "MCP response stream failed."));
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      clearTimers();
      const error = asError(reason, "MCP response stream was cancelled.");
      try {
        options.abort?.(error);
      } catch {
        // Continue cancelling the source reader below.
      }
      try {
        await reader.cancel(reason);
      } catch {
        // Best-effort: the underlying socket may already be closed.
      }
    },
  });
}

async function bodyToBytes(
  body: BodyInit | null | undefined,
  headers: Headers,
): Promise<Uint8Array | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) {
      headers.set(
        "content-type",
        "application/x-www-form-urlencoded;charset=UTF-8",
      );
    }
    return new TextEncoder().encode(body.toString());
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    );
  }

  // Blob, FormData, and ReadableStream are converted with the platform's Body
  // implementation so multipart boundaries/content types remain correct.
  const response = new Response(body);
  const inferredContentType = response.headers.get("content-type");
  if (inferredContentType && !headers.has("content-type")) {
    headers.set("content-type", inferredContentType);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function responseHeaders(rawHeaders: string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

/**
 * Adapt a Node IncomingMessage without using Readable.toWeb().
 *
 * Node's built-in adapter can leave its `data` listener live for a short
 * window after Web-stream cancellation. A late socket chunk then calls
 * `controller.enqueue()` after the controller has closed, which is promoted to
 * an uncaught exception by Trigger.dev. Owning the listeners here lets cancel
 * remove them synchronously before the socket is destroyed.
 */
function incomingMessageToWebStream(
  response: import("node:http").IncomingMessage,
): ReadableStream<Uint8Array> {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let terminal = false;

  const cleanup = () => {
    response.off("data", onData);
    response.off("end", onEnd);
    response.off("error", onError);
    response.off("aborted", onAborted);
    response.off("close", onClose);
  };

  const finish = (error?: Error) => {
    if (terminal) return;
    terminal = true;
    cleanup();
    try {
      if (error) controllerRef?.error(error);
      else controllerRef?.close();
    } catch {
      // A downstream cancellation may already have closed the controller.
    }
  };

  const onData = (chunk: Buffer | Uint8Array | string) => {
    if (terminal || !controllerRef) return;
    const bytes =
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk);
    try {
      controllerRef.enqueue(bytes);
      if ((controllerRef.desiredSize ?? 1) <= 0) response.pause();
    } catch {
      // The consumer disappeared between the terminal check and enqueue.
      terminal = true;
      cleanup();
      response.pause();
      response.destroy();
    }
  };

  const onEnd = () => finish();
  const onError = (error: Error) => finish(error);
  const onAborted = () =>
    finish(new Error("MCP response was aborted before completion."));
  const onClose = () => {
    if (response.complete) finish();
    else finish(new Error("MCP response closed before completion."));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      response.on("data", onData);
      response.once("end", onEnd);
      response.once("error", onError);
      response.once("aborted", onAborted);
      response.once("close", onClose);
      response.pause();
    },
    pull() {
      if (!terminal) response.resume();
    },
    cancel() {
      if (terminal) return;
      terminal = true;
      cleanup();
      response.pause();
      response.destroy();
    },
  });
}

/** Convert a validated Node response into the bounded Fetch response used by MCP. */
export function createGuardedMcpFetchResponse(
  response: import("node:http").IncomingMessage,
  method: string,
): Response {
  const status = response.statusCode;
  if (status === undefined || status < 200 || status > 599) {
    throw new McpResponsePolicyError(
      `MCP server returned an invalid HTTP status (${status ?? "missing"}).`,
    );
  }

  const responseHeaderBag = responseHeaders(response.rawHeaders);
  const contentType = responseHeaderBag.get("content-type") ?? "";
  const isEventStream = contentType
    .toLowerCase()
    .startsWith("text/event-stream");
  const declaredLength = Number(
    responseHeaderBag.get("content-length") ?? Number.NaN,
  );
  if (
    !isEventStream &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_BUFFERED_RESPONSE_BYTES
  ) {
    throw new McpResponsePolicyError(
      `MCP response exceeded the ${MAX_BUFFERED_RESPONSE_BYTES}-byte limit.`,
    );
  }

  const hasNoBody =
    method === "HEAD" || status === 204 || status === 205 || status === 304;
  const stream = hasNoBody
    ? null
    : guardMcpResponseStream(incomingMessageToWebStream(response), {
        isEventStream,
        // Error the Web stream first, then close the pinned socket without
        // emitting an unhandled Node stream error.
        abort: () => response.destroy(),
      });

  return new Response(stream, {
    status,
    statusText: response.statusMessage,
    headers: responseHeaderBag,
  });
}

/**
 * Dispatch through node:http(s), pinning hostname lookup to the address that
 * was just vetted. Native/global fetch would resolve the hostname again and
 * reopen a DNS-rebinding TOCTOU window.
 */
export const dispatchPinnedMcpRequest: ResolvedMcpDispatcher = async ({
  url,
  init,
  address,
  family,
}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  for (const forbidden of FORBIDDEN_CONFIGURED_HEADERS) {
    headers.delete(forbidden);
  }
  if (!headers.has("accept-encoding")) {
    headers.set("accept-encoding", "identity");
  }

  const body = await bodyToBytes(init.body, headers);
  if (body && !headers.has("content-length")) {
    headers.set("content-length", String(body.byteLength));
  }

  if (init.signal?.aborted) throw abortError(init.signal);

  const hostname = unwrappedHostname(url);
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method,
    headers: Object.fromEntries(headers.entries()),
    agent: false,
    lookup: createPinnedLookup(address, family),
  };

  if (url.protocol === "https:") {
    Object.assign(requestOptions, {
      rejectUnauthorized: true,
      // Preserve certificate verification/SNI for the original DNS name while
      // the socket itself is pinned to the approved address.
      servername: isIP(hostname) === 0 ? hostname : undefined,
    });
  }

  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let incoming: import("node:http").IncomingMessage | undefined;

    const cleanup = () => {
      init.signal?.removeEventListener("abort", onAbort);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      const error = abortError(init.signal);
      incoming?.destroy(error);
      request.destroy(error);
      rejectOnce(error);
    };

    const request = requestFn(requestOptions, (response) => {
      incoming = response;
      try {
        const fetchResponse = createGuardedMcpFetchResponse(response, method);
        settled = true;
        resolve(fetchResponse);
      } catch (error) {
        const safeError = asError(
          error,
          "MCP server returned a malformed HTTP response.",
        );
        rejectOnce(safeError);
        // Do not pass the error to destroy(): no response error listener exists
        // yet for malformed responses, so doing so could escape this Promise.
        response.destroy();
        request.destroy();
      }
    });
    init.signal?.addEventListener("abort", onAbort, { once: true });
    request.on("error", (error) => {
      rejectOnce(error);
    });
    request.on("close", cleanup);

    if (body && body.byteLength > 0) request.write(body);
    request.end();
  });
};

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

function validateConfiguredHeaders(headers: Headers): void {
  for (const name of headers.keys()) {
    if (FORBIDDEN_CONFIGURED_HEADERS.has(name)) {
      throw new Error(`MCP header "${name}" is not allowed.`);
    }
  }
}

function stripHeadersForCrossOrigin(
  headers: Headers,
  configuredHeaderNames: ReadonlySet<string>,
): Headers {
  const stripped = new Headers(headers);
  for (const name of Array.from(stripped.keys())) {
    if (
      configuredHeaderNames.has(name) ||
      ALWAYS_SENSITIVE_HEADERS.has(name) ||
      !CROSS_ORIGIN_HEADER_ALLOWLIST.has(name)
    ) {
      stripped.delete(name);
    }
  }
  return stripped;
}

function redirectedMethod(status: number, method: string): string {
  if (status === 303 && method !== "HEAD") return "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Fetch implementation for MCP transports. Every request/redirect resolves
 * afresh, blocks non-public address sets, and dispatches only to the vetted IP.
 */
export function createSafeMcpFetch(
  options: SafeMcpFetchOptions = {},
): McpFetch {
  const baseHeaders = new Headers(options.baseHeaders);
  validateConfiguredHeaders(baseHeaders);
  if (Array.from(baseHeaders.keys()).length > 0 && !options.configuredUrl) {
    throw new Error("MCP configured headers require a configured server URL.");
  }
  const configuredOrigin = options.configuredUrl
    ? new URL(
        canonicalizeMcpUrl(options.configuredUrl.toString(), {
          allowLocalDevelopment: options.allowLocalDevelopment,
        }),
      ).origin
    : undefined;
  const configuredHeaderNames = new Set(baseHeaders.keys());
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (
    !Number.isInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 10
  ) {
    throw new Error("MCP redirect limit must be an integer between 0 and 10.");
  }
  const dispatch = options.dispatch ?? dispatchPinnedMcpRequest;

  const safeFetch = async (
    input: McpFetchInput,
    init: RequestInit = {},
  ): Promise<Response> => {
    const inputRequest =
      typeof Request !== "undefined" && input instanceof Request
        ? input
        : undefined;
    const rawUrl = inputRequest?.url ?? input.toString();
    let provisional: URL;
    try {
      provisional = new URL(rawUrl);
    } catch {
      throw new Error("MCP request URL is invalid.");
    }

    // The development opt-in applies only when the chain itself starts on an
    // explicit loopback name. A public server cannot redirect into localhost.
    const allowLocalForChain =
      options.allowLocalDevelopment === true &&
      isExplicitLocalHostname(provisional.hostname);

    let currentUrl = new URL(
      canonicalizeMcpUrl(rawUrl, {
        allowLocalDevelopment: allowLocalForChain,
      }),
    );
    let method = (init.method ?? inputRequest?.method ?? "GET").toUpperCase();
    let headers = mergeHeaders(
      baseHeaders,
      inputRequest?.headers,
      init.headers,
    );
    if (configuredOrigin && currentUrl.origin !== configuredOrigin) {
      headers = stripHeadersForCrossOrigin(headers, configuredHeaderNames);
    }
    const signal = init.signal ?? inputRequest?.signal;
    let body = await bodyToBytes(init.body ?? inputRequest?.body, headers);

    for (let redirects = 0; ; redirects += 1) {
      if (signal?.aborted) throw abortError(signal);

      const target = await resolveSafeMcpTarget(currentUrl, {
        allowLocalDevelopment: allowLocalForChain,
        resolveHostname: options.resolveHostname,
      });

      const response = await dispatch({
        url: target.url,
        address: target.address,
        family: target.family,
        init: {
          ...init,
          method,
          headers,
          body: body as BodyInit | undefined,
          signal,
          redirect: "manual",
        },
      });

      if (!isRedirect(response.status) || init.redirect === "manual") {
        return response;
      }
      if (init.redirect === "error") {
        await response.body?.cancel();
        throw new Error("MCP server returned a redirect that was not allowed.");
      }
      if (redirects >= maxRedirects) {
        await response.body?.cancel();
        throw new Error(`MCP server exceeded ${maxRedirects} redirects.`);
      }

      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error("MCP redirect response did not include a location.");
      }

      let redirectedUrl: URL;
      try {
        redirectedUrl = new URL(location, currentUrl);
      } catch {
        throw new Error("MCP server returned an invalid redirect location.");
      }

      const previousOrigin = currentUrl.origin;
      currentUrl = new URL(
        canonicalizeMcpUrl(redirectedUrl.toString(), {
          allowLocalDevelopment: allowLocalForChain,
        }),
      );
      if (currentUrl.origin !== previousOrigin) {
        headers = stripHeadersForCrossOrigin(headers, configuredHeaderNames);
      }

      const nextMethod = redirectedMethod(response.status, method);
      if (nextMethod === "GET" && method !== "GET") {
        body = undefined;
        headers.delete("content-length");
        headers.delete("content-type");
      }
      method = nextMethod;
    }
  };

  // The MCP SDK's FetchLike excludes Request even though its EventSource
  // implementation can provide one; the implementation safely supports both.
  return safeFetch as McpFetch;
}
