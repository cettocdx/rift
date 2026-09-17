import { isProviderInFlightCapacityMessage } from "@/lib/utils/error-utils";

export interface ProviderCapacityProgress {
  status: "waiting" | "resuming";
  attempt: number;
  delayMs: number;
  retryAt: number;
}
export type OnProviderCapacity = (progress: ProviderCapacityProgress) => void;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Only retry an explicit pre-generation rejection. Never restart the agent,
 * replay a tool, or retry a stream that has already been accepted. */
export async function fetchWithProviderCapacityRecovery(
  url: Parameters<typeof fetch>[0],
  init?: RequestInit,
  onProgress?: OnProviderCapacity,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    init?.signal?.throwIfAborted();
    const response = await fetcher(url, init);
    if (response.status !== 402 || attempt >= 2 || typeof init?.body !== "string") return response;
    const payload = record(await response.clone().json().catch(() => null));
    const error = record(payload.error);
    const metadata = record(error.metadata);
    if (!isProviderInFlightCapacityMessage(`${metadata.reason ?? ""} ${error.message ?? ""}`)) return response;
    const headers = record(metadata.headers);
    const hint = response.headers.get("retry-after") ?? headers["Retry-After"] ?? headers["retry-after"];
    const value = typeof hint === "string" || typeof hint === "number" ? String(hint) : "";
    const seconds = value.trim() ? Number(value) : NaN;
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    const delayMs = Number.isFinite(parsed) ? Math.max(1000, parsed) : 5000 * (attempt + 1);
    if (Date.now() - started + delayMs > 300000) return response;
    await response.body?.cancel();
    const progress = { attempt: attempt + 1, delayMs, retryAt: Date.now() + delayMs };
    onProgress?.({ ...progress, status: "waiting" });
    await wait(delayMs, init.signal);
    onProgress?.({ ...progress, status: "resuming" });
  }
}
