import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

async function main() {
  const userId = process.env.RIFT_QA_USER_ID;
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!userId || !serviceKey) throw new Error("QA user and service authentication required");
  const { getConvexClient } = await import("../lib/db/convex-client");
  const { api } = await import("../convex/_generated/api");
  const content = "ğ🙂漢".repeat(160000);
  // An isolated diagnostic record, never a user task or a model request.
  const evidenceId = await getConvexClient().mutation(api.runs.recordEvidence, {
    serviceKey,
    userId,
    chatId: `qa-byte-cap-${randomUUID()}`,
    kind: "qa-utf8-byte-cap",
    content,
  });
  if (!evidenceId) throw new Error("Evidence was not persisted");
  writeFileSync("docs/qa/2026-09-10-storage-recovery/evidence-live.json", JSON.stringify({
    evidenceId,
    inputBytes: Buffer.byteLength(content),
    persisted: true,
  }, null, 2));
  console.log("Oversized UTF-8 evidence persisted successfully.");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
