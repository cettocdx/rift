import { getConvexClient } from "@/lib/db/convex-client";
import {
  getSandboxContext,
  type RelayConfigOrigin,
} from "@/lib/ai/sandbox-context";

/** Private server-side authority, never part of a tool's schema or result. */
export type RelayOrigin = Readonly<
  RelayConfigOrigin & {
    client: ReturnType<typeof getConvexClient> | undefined;
    serviceKey: string | undefined;
  }
>;

export function captureRelayOrigin(
  serviceKey: string | undefined,
  config = getSandboxContext().relay,
): RelayOrigin {
  let client: ReturnType<typeof getConvexClient> | undefined;
  if (serviceKey) {
    try {
      client = getConvexClient();
    } catch {
      /* Missing origin stays unavailable. */
    }
  }
  return Object.freeze({
    wsUrl: config.wsUrl,
    tokenSecret: config.tokenSecret,
    serviceKey,
    client,
  });
}
