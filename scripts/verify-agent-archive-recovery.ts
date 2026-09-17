import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
config({ path: ".env.local", quiet: true });
async function main() {
  const userId = process.env.RIFT_QA_USER_ID;
  if (!userId) throw new Error("RIFT_QA_USER_ID required");
  const { saveChat, saveMessage } = await import("../lib/db/actions");
  const { createReadRunArchive } =
    await import("../lib/ai/tools/read-run-archive");
  const chatId = randomUUID();
  const sentinel = `archive-recovery-${randomUUID()}`;
  await saveChat({
    id: chatId,
    userId,
    title: "QA: on-demand archive recovery",
    purpose: "app",
  });
  await saveMessage({
    chatId,
    userId,
    mode: "agent",
    finishReason: "stop",
    message: {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool-get_terminal_files",
          toolCallId: randomUUID(),
          state: "output-available",
          input: {},
          output: "a".repeat(600000) + sentinel + "z".repeat(600000),
        },
        { type: "text", text: "Archive retrieval verification fixture." },
      ] as any[],
    },
  });
  const tool = createReadRunArchive({ userID: userId, chatId });
  const options = { toolCallId: randomUUID(), messages: [] };
  const list: any = await tool.execute!(
    { action: "list", referenceOffset: 0, offset: 0, limit: 1000 },
    options,
  );
  if (!list.ok || !list.archives.length)
    throw new Error("Persisted archive reference missing");
  const read: any = await tool.execute!(
    {
      action: "read",
      referenceOffset: 0,
      archiveId: list.archives[0].archiveId,
      query: sentinel,
      offset: 0,
      limit: 200,
    },
    options,
  );
  if (!read.ok || !read.text?.includes(sentinel))
    throw new Error("Archived fact could not be recovered");
  const result = {
    chatId,
    passed: true,
    recoveredCharacters: read.text.length,
    archives: list.archives.length,
    modelCalls: 0,
  };
  mkdirSync("docs/qa/2026-09-12-archive-recovery", { recursive: true });
  writeFileSync(
    "docs/qa/2026-09-12-archive-recovery/live.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
