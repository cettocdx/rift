import "server-only";
import type { ChatSnapshot } from "@/convex/lib/chatSnapshot";

type SnapshotOwner = { userId: string; chatId: string; runId: string };

/** Request-local capability returned only after transactional worker activation. */
export class WorkerChatSnapshot {
  readonly #owner: SnapshotOwner;
  readonly #chat: ChatSnapshot;

  constructor(owner: SnapshotOwner, chat: ChatSnapshot) {
    if (chat && (chat.id !== owner.chatId || chat.user_id !== owner.userId)) {
      throw new Error("Worker chat snapshot owner mismatch");
    }
    this.#owner = { ...owner };
    this.#chat = chat;
  }

  read(owner: SnapshotOwner): ChatSnapshot {
    if (
      owner.userId !== this.#owner.userId ||
      owner.chatId !== this.#owner.chatId ||
      owner.runId !== this.#owner.runId
    ) {
      throw new Error("Worker chat snapshot claim mismatch");
    }
    return this.#chat;
  }
}
