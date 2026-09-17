import {
  captureSandboxContext,
  installSandboxContextReader,
  type SandboxContextOrigin,
} from "@/lib/ai/sandbox-context";
import {
  captureTelemetryContext,
  installTelemetryContextReader,
  type TelemetryContext,
} from "@/lib/posthog/context";
import {
  captureProviderContext,
  installProviderContextReader,
  type ProviderContext,
} from "@/lib/ai/provider-context";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  installConvexClientScopeReader,
  type ConvexClientScope,
} from "./convex-client";

import {
  captureRedisClientContext,
  installRedisClientContextReader,
  type RedisClientContext,
} from "@/lib/rate-limit/redis-context";

// Database and rate-limit operations share a lifecycle. A bound cancellation
// restores both clients' origins, including callbacks invoked after this run.
const storage = new AsyncLocalStorage<
  ConvexClientScope & {
    redis: RedisClientContext;
    provider: ProviderContext;
    telemetry: TelemetryContext;
    sandbox: SandboxContextOrigin;
  }
>();
installConvexClientScopeReader(() => storage.getStore());
installRedisClientContextReader(() => storage.getStore()?.redis);
installProviderContextReader(() => storage.getStore()?.provider);
installTelemetryContextReader(() => storage.getStore()?.telemetry);
installSandboxContextReader(() => storage.getStore()?.sandbox);

/** Capture every run's deployment, including the no-override/default case. */
export function withConvexClientScope<T>(
  url: string | undefined,
  callback: () => T,
): T {
  return storage.run(
    {
      url: url ?? process.env.NEXT_PUBLIC_CONVEX_URL,
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
      client: null,
      redis: captureRedisClientContext(),
      provider: captureProviderContext(),
      telemetry: captureTelemetryContext(),
      sandbox: captureSandboxContext(),
    },
    callback,
  );
}

/** Lifecycle hooks invoked outside the run must explicitly restore its scope. */
export function bindConvexClientScope<TArgs extends unknown[], TResult>(
  callback: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const scope = storage.getStore();
  if (!scope) throw new Error("No active Convex task scope");
  // Do not disable/clear storage on completion: pending callbacks belong to
  // their originating run even while another run executes in the process.
  return (...args) => storage.run(scope, () => callback(...args));
}
