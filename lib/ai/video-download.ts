import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";

const MAX_REDIRECTS = 4;
const MAX_DOWNLOAD_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2_000;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type VideoDownloadOptions = {
  apiKey: string;
  maxBytes: number;
  fetchImpl?: FetchLike;
};

function isOpenRouterApiUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "openrouter.ai" &&
    url.pathname.startsWith("/api/")
  );
}

function mediaTypeFrom(response: Response): string | undefined {
  const value = response.headers.get("content-type")?.split(";", 1)[0].trim();
  return value || undefined;
}

function assertSupportedUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("The video provider returned an unsafe download URL.");
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(response: Response | undefined, retryCount: number) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1_000));
    }

    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()));
    }
  }

  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** retryCount);
}

function waitForRetry(milliseconds: number, signal: AbortSignal | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Generated video exceeds the ${maxBytes}-byte limit.`);
  }

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maxBytes) {
      throw new Error(`Generated video exceeds the ${maxBytes}-byte limit.`);
    }
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Generated video exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/**
 * Download a completed OpenRouter video without exposing the API key to a
 * provider-owned redirect. OpenRouter's `/api/v1/videos/:id/content` endpoint
 * is authenticated even though it appears in the API response as an
 * `unsigned_urls` entry, so the AI SDK's generic unauthenticated downloader is
 * insufficient here.
 */
export function createOpenRouterVideoDownload({
  apiKey,
  maxBytes,
  fetchImpl = fetch,
}: VideoDownloadOptions) {
  const download = async (
    url: URL,
    abortSignal: AbortSignal | undefined,
    redirectCount: number,
    retryCount = 0,
  ): Promise<{ data: Uint8Array; mediaType: string | undefined }> => {
    assertSupportedUrl(url);
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error("The video download exceeded its redirect limit.");
    }

    const authenticate = isOpenRouterApiUrl(url);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: abortSignal,
        headers: authenticate
          ? {
              ...openrouterAttributionHeaders,
              Authorization: `Bearer ${apiKey}`,
            }
          : undefined,
      });
    } catch (error) {
      if (abortSignal?.aborted || retryCount >= MAX_DOWNLOAD_RETRIES) {
        throw error;
      }
      await waitForRetry(retryDelayMs(undefined, retryCount), abortSignal);
      return download(url, abortSignal, redirectCount, retryCount + 1);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("The video provider returned an invalid redirect.");
      }
      return download(new URL(location, url), abortSignal, redirectCount + 1);
    }

    if (!response.ok) {
      if (
        isRetryableStatus(response.status) &&
        retryCount < MAX_DOWNLOAD_RETRIES
      ) {
        await waitForRetry(retryDelayMs(response, retryCount), abortSignal);
        return download(url, abortSignal, redirectCount, retryCount + 1);
      }
      throw new Error(
        `Failed to download ${url.toString()}: ${response.status} ${response.statusText}`,
      );
    }

    return {
      data: await readBoundedResponse(response, maxBytes),
      mediaType: mediaTypeFrom(response),
    };
  };

  return ({ url, abortSignal }: { url: URL; abortSignal?: AbortSignal }) =>
    download(url, abortSignal, 0);
}
