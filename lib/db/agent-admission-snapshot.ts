import "server-only";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "./convex-client";
import { ChatSDKError } from "@/lib/errors";

type Owner = { userId: string; chatId: string };
type Snapshot = FunctionReturnType<
  typeof api.agentRunClaims.getAdmissionSnapshot
>;

/** Request-local read capability, never a substitute for reserve's live CAS. */
export class AgentAdmissionSnapshot {
  readonly #owner: Owner;
  readonly #snapshot: Snapshot;
  private constructor(owner: Owner, snapshot: Snapshot) {
    if (
      (snapshot.chat &&
        (snapshot.chat.id !== owner.chatId ||
          snapshot.chat.user_id !== owner.userId)) ||
      (snapshot.claim &&
        (snapshot.claim.chatId !== owner.chatId ||
          snapshot.claim.userId !== owner.userId))
    ) {
      throw new Error("Admission snapshot owner mismatch");
    }
    this.#owner = { ...owner };
    this.#snapshot = snapshot;
  }

  static async load(owner: Owner): Promise<AgentAdmissionSnapshot> {
    const boundOwner = { ...owner };
    try {
      const snapshot = await getConvexClient().query(
        api.agentRunClaims.getAdmissionSnapshot,
        {
          ...boundOwner,
          serviceKey: getConvexServiceKey()!,
        },
      );
      return new AgentAdmissionSnapshot(boundOwner, snapshot);
    } catch (error) {
      if (error instanceof ConvexError && error.data?.code === "FORBIDDEN") {
        throw new ChatSDKError("forbidden:chat");
      }
      throw error;
    }
  }

  read(owner: Owner): Snapshot {
    if (
      owner.userId !== this.#owner.userId ||
      owner.chatId !== this.#owner.chatId
    ) {
      throw new Error("Admission snapshot owner mismatch");
    }
    return this.#snapshot;
  }
}

export const getAgentAdmissionSnapshot = (owner: Owner) =>
  AgentAdmissionSnapshot.load(owner);
