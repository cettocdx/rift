/** @jest-environment node */
import { fetchWithProviderCapacityRecovery } from "../provider-capacity-fetch";
const capacity = (seconds = "120") => new Response(JSON.stringify({ error: {
  message: "This request would exceed your available credits given your current in-flight requests.",
  metadata: { reason: "in_flight_budget_exhausted", headers: { "Retry-After": seconds } },
} }), { status: 402 });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("waits for the reservation cooldown and retries only the rejected HTTP request", async () => {
  const body = JSON.stringify({ messages: [{ role: "tool", content: "already executed" }] });
  const fetcher = jest.fn().mockResolvedValueOnce(capacity()).mockResolvedValueOnce(new Response("accepted"));
  const status = jest.fn();
  const pending = fetchWithProviderCapacityRecovery("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body }, status, fetcher);
  await jest.advanceTimersByTimeAsync(1);
  expect(status).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting", attempt: 1, delayMs: 120000 }));
  await jest.advanceTimersByTimeAsync(119998);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(2);
  expect(await (await pending).text()).toBe("accepted");
  expect(fetcher.mock.calls[1][1].body).toBe(body);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});
it("does not retry real exhausted credit errors or successful streams", async () => {
  for (const response of [new Response('insufficient credits', {status:402}), new Response('stream')]) {
    const fetcher = jest.fn().mockResolvedValue(response);
    expect(await fetchWithProviderCapacityRecovery("url", {body:'{}'}, undefined, fetcher)).toBe(response);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("honors cancellation during cooldown without another request", async () => {
  const stop = new AbortController();
  const fetcher = jest.fn().mockResolvedValue(capacity());
  const pending = fetchWithProviderCapacityRecovery("url", { body: '{}', signal: stop.signal }, undefined, fetcher);
  const rejected = expect(pending).rejects.toThrow("Stopped");
  await jest.advanceTimersByTimeAsync(1);
  stop.abort(new Error("Stopped"));
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it("bounds recovery and returns the final provider response if still blocked", async () => {
  const fetcher = jest.fn().mockImplementation(async () => capacity());
  const pending = fetchWithProviderCapacityRecovery("url", {body:'{}'}, undefined, fetcher);
  await jest.advanceTimersByTimeAsync(240010);
  expect((await pending).status).toBe(402);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not shorten a provider cooldown that exceeds the recovery budget", async () => {
  const fetcher = jest.fn().mockResolvedValue(capacity("600"));
  expect((await fetchWithProviderCapacityRecovery("url", {body:'{}'}, undefined, fetcher)).status).toBe(402);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("uses Retry-After HTTP dates and leaves accepted error streams untouched", async () => {
  const date = new Date(Date.now() + 10000).toUTCString();
  const first = capacity("120"); first.headers.set("Retry-After", date);
  const fetcher = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(new Response('data: provider-stream-error\n\n', {headers:{'Content-Type':'text/event-stream'}}));
  const pending = fetchWithProviderCapacityRecovery("url", {body:'{}'}, undefined, fetcher);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await (await pending).text()).toContain("provider-stream-error");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
