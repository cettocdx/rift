import { ConvexHttpClient } from "convex/browser";

// Keep this entry point free of Node imports: Convex's deploy analyzer also
// reaches it through rate-limit/usage helpers. The worker-only scope module
// installs an accessor backed by AsyncLocalStorage, never a mutable URL.
export type ConvexClientScope = {
  url: string | undefined;
  serviceKey?: string;
  client: ConvexHttpClient | null;
};
let readScope: (() => ConvexClientScope | undefined) | undefined;
let defaultClient: ConvexClientScope | undefined;

export function installConvexClientScopeReader(
  reader: () => ConvexClientScope | undefined,
) {
  readScope = reader;
}

export function getConvexUrl(): string {
  const scope = readScope?.();
  const url = scope ? scope.url : process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/** A missing key in an active run must never borrow a later run's authority. */
export function getConvexServiceKey(): string | undefined {
  const scope = readScope?.();
  return scope ? scope.serviceKey : process.env.CONVEX_SERVICE_ROLE_KEY;
}

export function getConvexClient(): ConvexHttpClient {
  const scoped = readScope?.();
  const url = getConvexUrl();
  if (scoped) {
    return (scoped.client ??= new ConvexHttpClient(url));
  }
  // Server callers without a worker scope retain lazy initialization. An env
  // change must not keep the previous deployment's cached client alive here.
  if (!defaultClient || defaultClient.url !== url) {
    defaultClient = { url, client: new ConvexHttpClient(url) };
  }
  return defaultClient.client!;
}
