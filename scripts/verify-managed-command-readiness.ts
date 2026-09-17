import "dotenv/config";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { CentrifugoSandbox } from "../lib/ai/tools/utils/centrifugo-sandbox";
config({ path: ".env.local", quiet: true });
async function main() {
  const userId = process.env.RIFT_QA_USER_ID;
  const connectionId = process.env.RIFT_QA_CONNECTION_ID;
  if (!userId || !connectionId) throw new Error("Explicit QA owner and connection required");
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const connections = await client.query(api.localSandbox.listConnectionsForBackend, {
    serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY!, userId,
  });
  const connection = connections.find((entry) => entry.connectionId === connectionId);
  if (!connection?.capabilities?.commandReadiness) throw new Error("Updated receiver capability missing");
  const sandbox = new CentrifugoSandbox(userId, connection, {
    wsUrl: process.env.CENTRIFUGO_WS_URL!, tokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET!,
  });
  const result = await sandbox.commands.run("printf RIFT_READINESS_OK", { timeoutMs: 15000 });
  if (result.exitCode !== 0 || result.stdout !== "RIFT_READINESS_OK") throw new Error("Managed command failed");
  console.log(JSON.stringify({ connectionId, commandReadiness: true, ...result }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
