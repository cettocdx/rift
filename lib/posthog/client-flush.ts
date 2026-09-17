import type { PostHog } from "posthog-node";

const tracked = new WeakSet<PostHog>();
const active = new WeakMap<PostHog, number>();

/** Track the public SDK boundary, including its automatic threshold flushes. */
export function trackPostHogClientFlushes(client: PostHog): PostHog {
  if (tracked.has(client)) return client;
  tracked.add(client);
  const flush = client.flush.bind(client);
  client.flush = async (...args: Parameters<PostHog["flush"]>) => {
    active.set(client, (active.get(client) ?? 0) + 1);
    try {
      return await flush(...args);
    } finally {
      const remaining = active.get(client)! - 1;
      if (remaining) active.set(client, remaining);
      else active.delete(client);
    }
  };
  return client;
}

export function isPostHogClientFlushing(client: PostHog): boolean {
  return active.has(client);
}
