import type { BrowserContext } from "@playwright/test";

/** Install before any app navigation; never synthesize successful backend replies. */
export async function installReadOnlyGuard(
  context: BrowserContext,
  appURL: string,
  convexURL: string,
  blocked: string[],
) {
  const appOrigin = new URL(appURL).origin;
  const convex = new URL(convexURL);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const writeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method());
    const appWrite =
      url.origin === appOrigin &&
      writeMethod &&
      !/^\/api\/auth(?:\/|$)/.test(url.pathname);
    // ConvexHttpClient supports these read-only POST endpoints. /api/function
    // is deliberately blocked: its endpoint alone does not prove a query.
    const convexWrite =
      url.origin === convex.origin &&
      writeMethod &&
      !/^\/api\/query(?:_ts|_at_ts)?$/.test(url.pathname);
    if (appWrite || convexWrite) {
      blocked.push(`${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  // Verified against installed Playwright 1.55 types and client/network.js:
  // onMessage disables outgoing auto-forwarding; server replies still forward.
  await context.routeWebSocket(
    (url) => url.host === convex.host,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        let frame: unknown;
        try {
          frame = JSON.parse(
            typeof message === "string" ? message : message.toString("utf8"),
          );
        } catch {
          blocked.push("Convex unsupported client frame");
          return;
        }
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
          blocked.push("Convex unsupported client frame");
          return;
        }
        const { type, udfPath } = frame as Record<string, unknown>;
        if (type === "Mutation" || type === "Action") {
          const name =
            typeof udfPath === "string" && /^[\w./:-]{1,160}$/.test(udfPath)
              ? udfPath
              : "unknown function";
          blocked.push(`Convex ${type} ${name}`);
          return;
        }
        // Actual read/auth/telemetry envelopes from Convex's sync/protocol.ts.
        // Unknown future envelopes fail closed rather than bypassing the guard.
        if (
          !["Connect", "Authenticate", "ModifyQuerySet", "Event"].includes(
            String(type),
          )
        ) {
          blocked.push("Convex unsupported client frame");
          return;
        }
        server.send(message);
      });
    },
  );
}
