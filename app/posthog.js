import { trackPostHogClientFlushes } from "@/lib/posthog/client-flush";
import { getTelemetryContext } from "@/lib/posthog/context";
import { PostHog } from "posthog-node";

/** @param {import("@/lib/posthog/context").TelemetryContext} [context] */
export default function PostHogClient(context = getTelemetryContext()) {
  if (!context.analyticsKey) {
    return null;
  }

  const posthogClient = new PostHog(context.analyticsKey, {
    host: context.analyticsHost,
    flushAt: 20,
    flushInterval: 0,
  });

  return trackPostHogClientFlushes(posthogClient);
}
