import "server-only";
import { AgentRunCanceledError } from "@/lib/agent/claim-cancellation";
import { AgentAdmissionSnapshot } from "@/lib/db/agent-admission-snapshot";
import { WorkerChatSnapshot } from "@/lib/db/worker-chat-snapshot";
import { randomUUID } from "node:crypto";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { getChatById } from "@/lib/db/actions";
import { ChatSDKError } from "@/lib/errors";
import {
  cancelRunAndConfirm,
  getOwnedTaggedRunIds,
  isRunActive,
} from "./agent-long-runs";

type Owner = { userId: string; chatId: string };
type ClaimRun = Owner & {
  claimId: string;
  runId: string;
  sandboxPreference?: string;
};
const withAuthority = <T extends Owner>(args: T) => ({
  ...args,
  serviceKey: getConvexServiceKey()!,
});

export class AgentRunBusyError extends Error {
  constructor(public readonly runId?: string) {
    super(
      runId
        ? "A run is already active in this chat."
        : "A run is already starting in this chat. Please try again shortly.",
    );
  }
}
export class AgentRunClaimLostError extends Error {
  constructor() {
    super(
      "This agent start is no longer current. Please return to the current run.",
    );
  }
}
export function getAgentRunClaim(args: Owner) {
  return getConvexClient().query(
    api.agentRunClaims.getForBackend,
    withAuthority(args),
  );
}
export function requireRemoteRunCleanup(args: ClaimRun) {
  return getConvexClient().mutation(
    api.agentRunClaims.requireRemoteCleanup,
    withAuthority(args),
  );
}
export function confirmRemoteRunCleanup(args: ClaimRun) {
  return getConvexClient().mutation(
    api.agentRunClaims.confirmRemoteCleanup,
    withAuthority(args),
  );
}
export function releaseAgentRunClaim(
  args: Owner & { claimId: string; runId?: string; failureMessage?: string },
) {
  return getConvexClient().mutation(
    api.agentRunClaims.release,
    withAuthority(args),
  );
}

export function requestAgentRunCancellation(
  args: Owner & { claimId: string; runId?: string; reason?: "replace" },
) {
  return getConvexClient().mutation(
    api.agentRunClaims.requestCancellation,
    withAuthority(args),
  );
}

/** This check applies to every claimed worker purpose, not only checkpointed apps. */
export async function assertAgentRunExecutionCurrent(
  args: ClaimRun & { temporary?: boolean },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AgentRunCanceledError();
  const { temporary, userId, chatId, claimId, runId } = args;
  const owner = { userId, chatId, claimId, runId };
  const current = await getConvexClient().query(
    api.agentRunClaims.isExecutionCurrent,
    withAuthority({ ...owner, requireChat: !temporary }),
  );
  if (signal?.aborted) throw new AgentRunCanceledError();
  if (!current) await throwWorkerClaimRejection(owner);
}

/** False admission alone is not proof of Stop. Read only on the denial path,
 * and never mistake a replaced claim, foreign owner or failed read for a cancel. */
async function throwWorkerClaimRejection(
  args: ClaimRun,
  allowUnboundPrivateStart = false,
): Promise<never> {
  const current = await getAgentRunClaim({
    userId: args.userId,
    chatId: args.chatId,
  });
  const exactOwnerClaim =
    current?.userId === args.userId &&
    current.chatId === args.chatId &&
    current.claimId === args.claimId;
  const exactBoundRun =
    current?.runId === args.runId &&
    (current.phase === "active" || current.phase === "released");
  const stoppedPrivateStart =
    allowUnboundPrivateStart &&
    (current?.phase === "starting" || current?.phase === "released") &&
    current.runId === undefined;
  if (
    exactOwnerClaim &&
    (exactBoundRun || stoppedPrivateStart) &&
    typeof current.cancelRequestedAt === "number" &&
    Number.isFinite(current.cancelRequestedAt)
  ) {
    throw new AgentRunCanceledError({
      userId: args.userId,
      chatId: args.chatId,
      claimId: args.claimId,
      ...(exactBoundRun ? { runId: args.runId } : {}),
    });
  }
  throw new AgentRunClaimLostError();
}

/** Use only after Trigger confirms this run is canceled. */
export async function releaseCanceledAgentRunClaim(args: ClaimRun) {
  if (await releaseAgentRunClaim(args)) return true;
  // The route may have failed to bind the accepted run. Each attempt still
  // compares the original claim, so a replacement can never be released.
  const { runId: _runId, ...reservation } = args;
  if (await releaseAgentRunClaim(reservation)) return true;
  // A queued worker can bind between the two attempts above.
  return releaseAgentRunClaim(args);
}

/** Recheck admission after slow preparation, before saving or dispatching. */
export async function assertAgentRunStartCurrent(
  args: Owner & { claimId: string },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AgentRunClaimLostError();
  const current = await getAgentRunClaim({
    userId: args.userId,
    chatId: args.chatId,
  });
  if (
    signal?.aborted ||
    current?.claimId !== args.claimId ||
    current.cancelRequestedAt !== undefined ||
    current.phase !== "starting" ||
    current.runId !== undefined
  )
    throw new AgentRunClaimLostError();
}

/** Remote liveness is evidence for a CAS, never a substitute for the CAS. */
export async function acquireAgentRunStart(
  args: Owner & {
    activeRunId?: string;
    temporary?: boolean;
    replaceActiveRun?: boolean;
    /** Server-read snapshot from this admission request; never request JSON. */
    chatSnapshot?: Awaited<ReturnType<typeof getChatById>>;
    admissionSnapshot?: AgentAdmissionSnapshot;
  },
): Promise<string> {
  const owner = { userId: args.userId, chatId: args.chatId };
  if (
    args.admissionSnapshot !== undefined &&
    !(args.admissionSnapshot instanceof AgentAdmissionSnapshot)
  ) {
    throw new Error("Invalid admission snapshot");
  }
  const admission = args.admissionSnapshot?.read(owner);
  // Only fresh persisted admission reuses the earlier claim observation.
  // Reserve still checks current ownership, mapping and claim transactionally.
  const reuseClaim =
    !args.temporary &&
    admission !== undefined &&
    !args.activeRunId &&
    !admission.chat?.active_trigger_run_id &&
    (!admission.claim || admission.claim.phase === "released");
  const [previous, initialChat] = await Promise.all([
    reuseClaim ? Promise.resolve(admission.claim) : getAgentRunClaim(owner),
    admission !== undefined && !args.temporary
      ? Promise.resolve(admission.chat)
      : args.chatSnapshot !== undefined
        ? Promise.resolve(args.chatSnapshot)
        : getChatById({ id: args.chatId }),
  ]);
  // Keep the original predecessor immutable across liveness/cancellation awaits.
  const previousClaimId = previous?.claimId ?? null;
  if (initialChat && initialChat.user_id !== args.userId)
    throw new ChatSDKError("forbidden:chat");
  const checkedRunIds = new Set<string>();
  if (args.activeRunId) checkedRunIds.add(args.activeRunId);
  if (previous?.phase !== "released" && previous?.runId)
    checkedRunIds.add(previous.runId);
  // Migration path for temporary runs accepted before durable claims existed.
  if (args.temporary && (!previous || previous.phase === "released")) {
    for (const id of await getOwnedTaggedRunIds(owner)) checkedRunIds.add(id);
  }
  for (const runId of checkedRunIds) {
    if (await isRunActive(runId)) {
      if (!args.replaceActiveRun) throw new AgentRunBusyError(runId);
      if (previous?.phase !== "released" && previous?.runId === runId) {
        const marked = await requestAgentRunCancellation({
          ...owner,
          claimId: previous.claimId,
          runId,
          reason: "replace",
        });
        if (!marked) throw new AgentRunBusyError(runId);
      }
      await cancelRunAndConfirm(runId);
    }
  }

  // Remote liveness/cancellation may change the mapping, so re-read after
  // those awaits. For fresh admission use the parallel snapshot: reserve's
  // transaction checks ownership AND the expected mapping again atomically.
  const chat =
    checkedRunIds.size > 0
      ? await getChatById({ id: args.chatId })
      : initialChat;
  if (chat && chat.user_id !== args.userId)
    throw new ChatSDKError("forbidden:chat");
  const mappedRunId = chat?.active_trigger_run_id;
  if (mappedRunId && !checkedRunIds.has(mappedRunId))
    throw new AgentRunBusyError(mappedRunId);
  const claimId = randomUUID();
  const result = await getConvexClient().mutation(
    api.agentRunClaims.reserveObserved,
    withAuthority({
      ...owner,
      claimId,
      previousClaimId,
      ...(mappedRunId ? { expectedChatRunId: mappedRunId } : {}),
      ...(previous?.phase !== "released" && previous?.runId
        ? { expectedClaimId: previous.claimId, expectedRunId: previous.runId }
        : {}),
    }),
    // Prior-run cancellation/cleanup above is already awaited. The server
    // checks the observed generation atomically; unrelated requests sharing
    // this HTTP client must not queue ahead of a fresh reservation.
    { skipQueue: true },
  );
  if (!result.acquired) throw new AgentRunBusyError(result.runId);
  return claimId;
}

/** Route bookkeeping can arrive after a fast worker already finished. */
export async function registerAgentRun(args: ClaimRun): Promise<void> {
  const activated = await getConvexClient().mutation(
    api.agentRunClaims.activate,
    withAuthority(args),
  );
  if (activated) return;
  const current = await getAgentRunClaim({
    userId: args.userId,
    chatId: args.chatId,
  });
  if (
    current?.claimId === args.claimId &&
    current.runId === args.runId &&
    current.phase === "released"
  )
    return;
  throw new AgentRunClaimLostError();
}

type WorkerStartArgs = Owner & {
  runId: string;
  startClaimId?: string;
  sandboxPreference?: string;
};

async function prepareWorkerClaim(args: WorkerStartArgs): Promise<string> {
  const owner = { userId: args.userId, chatId: args.chatId };
  const claimId = args.startClaimId ?? `legacy_${args.runId}`;
  if (!args.startClaimId) {
    // Scheduled runs and already queued pre-migration workers acquire their
    // own reservation. They never supersede a newer route's claim, even if it
    // has already finished, because their payload may describe older work.
    const previous = await getAgentRunClaim(owner);
    if (previous && previous.claimId !== claimId)
      throw new AgentRunClaimLostError();
    if (!previous) {
      const chat = await getChatById({ id: args.chatId });
      if (chat && chat.user_id !== args.userId)
        throw new ChatSDKError("forbidden:chat");
      if (
        chat?.active_trigger_run_id &&
        chat.active_trigger_run_id !== args.runId
      )
        throw new AgentRunClaimLostError();
      const reserved = await getConvexClient().mutation(
        api.agentRunClaims.reserveObserved,
        withAuthority({
          ...owner,
          claimId,
          previousClaimId: null,
          ...(chat?.active_trigger_run_id
            ? { expectedChatRunId: chat.active_trigger_run_id }
            : {}),
        }),
      );
      if (!reserved.acquired) throw new AgentRunClaimLostError();
    }
  }
  return claimId;
}

/** Must succeed before the worker fetches user content, opens tools or bills. */
export async function startClaimedAgentRun(
  args: WorkerStartArgs,
): Promise<string> {
  const claimId = await prepareWorkerClaim(args);
  const owner = { userId: args.userId, chatId: args.chatId };
  const activated = await getConvexClient().mutation(
    api.agentRunClaims.activate,
    withAuthority({
      ...owner,
      claimId,
      runId: args.runId,
      ...(args.sandboxPreference !== undefined
        ? { sandboxPreference: args.sandboxPreference }
        : {}),
    }),
  );
  if (!activated) throw new AgentRunClaimLostError();
  return claimId;
}

/** Retains the owned activation snapshot for this worker invocation only. */
export async function startClaimedAgentRunForWorker(
  args: WorkerStartArgs & { temporary?: boolean; workerEntryId?: string },
): Promise<{
  claimId: string;
  chatSnapshot: WorkerChatSnapshot;
  remoteCleanupRequired: boolean;
}> {
  const claimId = await prepareWorkerClaim(args);
  const activated = await getConvexClient().mutation(
    api.agentRunClaims.activateForWorker,
    withAuthority({
      userId: args.userId,
      chatId: args.chatId,
      claimId,
      runId: args.runId,
      requireChat: !args.temporary,
      requireRemoteCleanup: true,
      ...(args.workerEntryId ? { workerEntryId: args.workerEntryId } : {}),
      ...(args.sandboxPreference !== undefined
        ? { sandboxPreference: args.sandboxPreference }
        : {}),
    }),
  );
  if (!activated.activated) {
    await throwWorkerClaimRejection(
      { ...args, claimId },
      args.startClaimId === claimId,
    );
  }
  if (!activated.activated || (!args.temporary && !activated.chat)) {
    throw new AgentRunClaimLostError();
  }
  return {
    claimId,
    remoteCleanupRequired: activated.remoteCleanupRequired === true,
    chatSnapshot: new WorkerChatSnapshot(
      { userId: args.userId, chatId: args.chatId, runId: args.runId },
      activated.chat,
    ),
  };
}
