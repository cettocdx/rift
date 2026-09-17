import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { Centrifuge } from "centrifuge";
import { generateCentrifugoToken } from "@/lib/centrifugo/jwt";
import { sandboxConnectionChannel } from "@/lib/centrifugo/types";
import { presenceHasConnectionId } from "@/lib/centrifugo/presence";

/** A read-only probe. Never send a command to discover whether a runner exists. */
export async function assertLocalSandboxOnline(
  userId: string,
  connectionId: string,
  wsUrl: string,
  origin = getSandboxContext().relay,
): Promise<void> {
  const token = await generateCentrifugoToken(userId, 30, origin);
  const client = new Centrifuge(wsUrl, { token });
  const subscription = client.newSubscription(
    sandboxConnectionChannel(userId, connectionId),
  );
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let inspecting = false;
    let subscribed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (online: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(retryTimer);
      subscription.removeAllListeners();
      client.removeAllListeners();
      subscription.unsubscribe();
      client.disconnect();
      if (online) resolve();
      else
        reject(
          new Error(
            "The selected local runner is offline or unavailable. Reconnect it and retry; no cloud workspace was created.",
          ),
        );
    };
    const timeout = setTimeout(() => finish(false), 5_000);
    const inspect = () => {
      if (settled || inspecting || !subscribed) return;
      clearTimeout(retryTimer);
      inspecting = true;
      void subscription
        .presence()
        .then(
          (presence) => {
            if (presenceHasConnectionId(presence, connectionId)) finish(true);
          },
          // A lost presence response does not prove that the runner is offline.
          // Retry this read against the same subscription within the deadline.
          () => {},
        )
        .finally(() => {
          inspecting = false;
          if (!settled && subscribed) retryTimer = setTimeout(inspect, 500);
        });
    };
    subscription.on("subscribed", () => {
      subscribed = true;
      inspect();
    });
    subscription.on("subscribing", () => {
      subscribed = false;
      clearTimeout(retryTimer);
    });
    // Transient transport/subscription errors are retried by Centrifuge. Its
    // terminal states below still fail immediately (including unauthorized).
    subscription.on("error", () => {});
    client.on("error", () => {});
    subscription.on("unsubscribed", () => finish(false));
    client.on("disconnected", () => finish(false));
    subscription.subscribe();
    client.connect();
  });
}
