import { hasBlockingHttpExecution } from "./lib/hackHttpExecutions";
import {
  hasPendingHackCleanup,
  readClaimCleanupReceipt,
} from "./lib/hackRunCleanup";
import {
  admissionEnabled,
  readAdmissionGate,
  isAdmissionGateBlocking,
  revokeAdmissionGateForStop,
  readDispatchStop,
} from "./lib/agentDispatchAdmission";
import { chatSnapshotValidator, toChatSnapshot } from "./lib/chatSnapshot";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { saveOwnedChat } from "./lib/chatPersistence";
import {
  extractFileIdsFromParts,
  extractTextFromParts,
} from "./lib/messageParts";

const STARTUP_LEASE_MS = 90_000;
const phase = v.union(
  v.literal("starting"),
  v.literal("active"),
  v.literal("released"),
);
const claimFields = {
  claimId: v.string(),
  runId: v.optional(v.string()),
  phase,
  startedAt: v.number(),
  leaseUntil: v.number(),
  cancelRequestedAt: v.optional(v.number()),
};
const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
};

function requireIdentifier(value: string) {
  if (!value || value.length > 200 || value.trim() !== value) {
    throw new ConvexError({
      code: "INVALID_CLAIM",
      message: "Invalid agent run claim identifier",
    });
  }
}

async function readOwned(
  ctx: { db: QueryCtx["db"] },
  args: { serviceKey: string; userId: string; chatId: string },
) {
  validateServiceKey(args.serviceKey);
  requireIdentifier(args.userId);
  requireIdentifier(args.chatId);
  const [chats, claims] = await Promise.all([
    ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .take(2),
    ctx.db
      .query("agent_run_claims")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .take(2),
  ]);
  // The indexed reads participate in the mutation transaction: concurrent
  // first reservations conflict and retry instead of inserting duplicate IDs.
  if (chats.length > 1 || claims.length > 1) {
    throw new ConvexError({
      code: "CLAIM_CONFLICT",
      message: "Chat claim is ambiguous",
    });
  }
  const chat = chats[0];
  const claim = claims[0];
  if (
    (chat && chat.user_id !== args.userId) ||
    (claim && claim.user_id !== args.userId)
  ) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not own this chat",
    });
  }
  return { chat, claim };
}

function publicClaim(claim: Doc<"agent_run_claims">) {
  return {
    claimId: claim.claim_id,
    ...(claim.run_id !== undefined ? { runId: claim.run_id } : {}),
    phase: claim.phase,
    startedAt: claim.started_at,
    leaseUntil: claim.lease_until,
    ...(claim.cancel_requested_at !== undefined
      ? { cancelRequestedAt: claim.cancel_requested_at }
      : {}),
  };
}

export const getForBackend = query({
  args: ownerArgs,
  returns: v.union(
    v.null(),
    v.object({ ...claimFields, userId: v.string(), chatId: v.string() }),
  ),
  handler: async (ctx, args) => {
    const { claim } = await readOwned(ctx, args);
    return claim
      ? { ...publicClaim(claim), userId: claim.user_id, chatId: claim.chat_id }
      : null;
  },
});

/** Additive endpoint: old routes retain their existing query contract. */
export const getAdmissionSnapshot = query({
  args: ownerArgs,
  returns: v.object({
    chat: chatSnapshotValidator,
    claim: v.union(
      v.null(),
      v.object({ ...claimFields, userId: v.string(), chatId: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const { chat, claim } = await readOwned(ctx, args);
    return {
      chat: toChatSnapshot(chat ?? null),
      claim: claim
        ? {
            ...publicClaim(claim),
            userId: claim.user_id,
            chatId: claim.chat_id,
          }
        : null,
    };
  },
});

const reserveArgs = {
  ...ownerArgs,
  claimId: v.string(),
  expectedClaimId: v.optional(v.string()),
  expectedRunId: v.optional(v.string()),
  expectedChatRunId: v.optional(v.string()),
};

type ReserveArgs = {
  serviceKey: string;
  userId: string;
  chatId: string;
  claimId: string;
  expectedClaimId?: string;
  expectedRunId?: string;
  expectedChatRunId?: string;
};

async function reserveClaim(
  ctx: MutationCtx,
  args: ReserveArgs,
  observation?: { previousClaimId: string | null },
) {
  const { chat, claim } = await readOwned(ctx, args);
  requireIdentifier(args.claimId);
  if (observation && observation.previousClaimId !== null)
    requireIdentifier(observation.previousClaimId);
  for (const id of [
    args.expectedClaimId,
    args.expectedRunId,
    args.expectedChatRunId,
  ]) {
    if (id !== undefined) requireIdentifier(id);
  }
  const now = Date.now();
  const blocked = () => ({
    acquired: false,
    ...(claim
      ? publicClaim(claim)
      : {
          claimId: args.claimId,
          ...(chat?.active_trigger_run_id
            ? { runId: chat.active_trigger_run_id }
            : {}),
          phase: "active" as const,
          startedAt: now,
          leaseUntil: now,
        }),
  });
  if (
    admissionEnabled() &&
    isAdmissionGateBlocking(await readAdmissionGate(ctx, args.chatId))
  )
    return blocked();
  if (await hasBlockingHttpExecution(ctx, args)) return blocked();
  if (await hasPendingHackCleanup(ctx, args)) return blocked();
  // Also fence legacy writers that do not have a claim row yet. Absence is
  // an expected value, not permission to overwrite any currently active run.
  if (chat?.active_trigger_run_id !== args.expectedChatRunId) return blocked();

  if (claim) {
    // Terminality of the producer is not proof that its remote effects stopped.
    if (claim.remote_cleanup_required && !claim.remote_cleanup_confirmed)
      return blocked();
    // Retrying the same reservation is idempotent, but never renews a lease
    // or revives a released/expired claim whose worker may arrive late.
    if (claim.claim_id === args.claimId) {
      return {
        acquired:
          claim.cancel_requested_at === undefined &&
          claim.phase === "starting" &&
          claim.run_id === undefined &&
          claim.lease_until > now,
        ...publicClaim(claim),
      };
    }
    const explicitTakeover =
      args.expectedClaimId === claim.claim_id &&
      args.expectedRunId !== undefined &&
      args.expectedRunId === claim.run_id;
    const expiredStartup =
      claim.phase === "starting" &&
      claim.run_id === undefined &&
      claim.lease_until <= now;
    if (claim.phase !== "released" && !expiredStartup && !explicitTakeover)
      return blocked();
    // Active claims never expire by time alone. The caller must confirm the
    // remote run is terminal/canceled before supplying both expected IDs.
  } else if (
    args.expectedClaimId !== undefined ||
    args.expectedRunId !== undefined
  ) {
    return blocked();
  }

  // A same-current live retry returned above. Every newly installed ID must
  // still follow the exact predecessor this request originally observed.
  if (observation && observation.previousClaimId !== (claim?.claim_id ?? null))
    return blocked();

  const next = {
    user_id: args.userId,
    chat_id: args.chatId,
    claim_id: args.claimId,
    dispatch_id: undefined,
    phase: "starting" as const,
    run_id: undefined,
    started_at: now,
    lease_until: now + STARTUP_LEASE_MS,
    expected_chat_run_id: args.expectedChatRunId,
    cancel_requested_at: undefined,
    remote_cleanup_required: undefined,
    remote_cleanup_confirmed: undefined,
    resource_journal_enabled: undefined,
  };
  if (claim) await ctx.db.patch(claim._id, next);
  else await ctx.db.insert("agent_run_claims", next);
  return {
    acquired: true,
    claimId: args.claimId,
    phase: "starting" as const,
    startedAt: now,
    leaseUntil: next.lease_until,
  };
}

/** Legacy API: retains its contract, without predecessor replay protection. */
export const reserve = mutation({
  args: reserveArgs,
  returns: v.object({ acquired: v.boolean(), ...claimFields }),
  handler: (ctx, args) => reserveClaim(ctx, args),
});

/** Keep the original observation on retry; never rebase a delayed request. */
export const reserveObserved = mutation({
  args: { ...reserveArgs, previousClaimId: v.union(v.string(), v.null()) },
  returns: v.object({ acquired: v.boolean(), ...claimFields }),
  handler: (ctx, args) => reserveClaim(ctx, args, args),
});

const activationArgs = {
  ...ownerArgs,
  claimId: v.string(),
  runId: v.string(),
  sandboxPreference: v.optional(v.string()),
};
async function activateOwnedClaim(
  ctx: MutationCtx,
  args: {
    serviceKey: string;
    userId: string;
    chatId: string;
    claimId: string;
    runId: string;
    sandboxPreference?: string;
    workerEntryId?: string;
  },
  requireChat = false,
  requireWorkerEntry = false,
  requireRemoteCleanup = false,
) {
  const { chat, claim } = await readOwned(ctx, args);
  if (requireChat && !chat) return { activated: false as const };
  requireIdentifier(args.claimId);
  requireIdentifier(args.runId);
  if (
    !claim ||
    claim.claim_id !== args.claimId ||
    claim.phase === "released" ||
    claim.cancel_requested_at !== undefined ||
    (requireRemoteCleanup && claim.remote_cleanup_confirmed)
  )
    return { activated: false as const };
  if (await hasPendingHackCleanup(ctx, args, claim.claim_id))
    return { activated: false as const };
  const receipt = await readClaimCleanupReceipt(ctx, args, claim);
  if (receipt?.cleanup_confirmed_at !== undefined)
    return { activated: false as const };
  if (
    requireWorkerEntry &&
    receipt?.worker_lifecycle_version === 1 &&
    (!args.workerEntryId ||
      receipt.worker_entry_id !== args.workerEntryId ||
      receipt.worker_effects_started_at === undefined)
  )
    return { activated: false as const };
  if (
    claim.dispatch_id &&
    (await readDispatchStop(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      dispatchId: claim.dispatch_id,
    }))
  )
    return { activated: false as const };
  if (claim.phase === "active" && claim.run_id !== args.runId)
    return { activated: false as const };
  if (claim.phase === "starting" && claim.run_id !== undefined)
    return { activated: false as const };
  // Expiry lets another reservation reclaim a startup; it does not kill an
  // accepted run waiting in Trigger's queue. This transaction decides the
  // race: a new claim that wins first changes the token, while this worker
  // winning first makes the claim active and therefore non-expiring.
  if (
    chat?.active_trigger_run_id !== undefined &&
    chat.active_trigger_run_id !== args.runId &&
    chat.active_trigger_run_id !== claim.expected_chat_run_id
  )
    return { activated: false as const };
  if (args.sandboxPreference !== undefined)
    requireIdentifier(args.sandboxPreference);
  await ctx.db.patch(claim._id, {
    phase: "active",
    run_id: args.runId,
    ...(requireRemoteCleanup ? { remote_cleanup_required: true } : {}),
  });
  let chatPatch: Partial<Doc<"chats">> = {};
  if (chat && chat.active_trigger_run_id !== args.runId) {
    chatPatch = {
      active_trigger_run_id: args.runId,
      active_http_execution_id: undefined,
      last_run_error: undefined,
      ...(args.sandboxPreference !== undefined
        ? { sandbox_type: args.sandboxPreference }
        : {}),
      // A Stop from the previous run must not poison a newly reserved task.
      // Preserve a Stop issued after this reservation, including while queued.
      ...(chat.canceled_at !== undefined && chat.canceled_at < claim.started_at
        ? { canceled_at: undefined, cancel_skip_save: undefined }
        : {}),
    };
    await ctx.db.patch(chat._id, chatPatch);
  }
  return {
    activated: true as const,
    ...(requireRemoteCleanup ? { remoteCleanupRequired: true as const } : {}),
    chat: toChatSnapshot(chat ? { ...chat, ...chatPatch } : null),
  };
}

/** Existing callers retain the boolean activation contract. */
export const activate = mutation({
  args: activationArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => (await activateOwnedClaim(ctx, args)).activated,
});

/** Snapshot content is returned only after the owner-bound activation succeeds. */
export const activateForWorker = mutation({
  args: {
    ...activationArgs,
    requireChat: v.boolean(),
    requireRemoteCleanup: v.optional(v.boolean()),
    workerEntryId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ activated: v.literal(false) }),
    v.object({
      activated: v.literal(true),
      chat: chatSnapshotValidator,
      remoteCleanupRequired: v.optional(v.literal(true)),
    }),
  ),
  handler: async (ctx, args) =>
    activateOwnedClaim(
      ctx,
      args,
      args.requireChat,
      true,
      args.requireRemoteCleanup === true,
    ),
});

/** Stamp intent before remote cancellation. Never release an active worker here. */
export const requestCancellation = mutation({
  args: {
    ...ownerArgs,
    claimId: v.string(),
    runId: v.optional(v.string()),
    reason: v.optional(v.literal("replace")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    if (args.runId !== undefined) requireIdentifier(args.runId);
    if (
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.run_id !== args.runId ||
      claim.phase === "released"
    )
      return false;
    if (args.reason === "replace") {
      if (
        admissionEnabled() &&
        isAdmissionGateBlocking(await readAdmissionGate(ctx, args.chatId))
      )
        return false;
    } else {
      await revokeAdmissionGateForStop(ctx, args);
    }
    if (claim.cancel_requested_at === undefined)
      await ctx.db.patch(claim._id, { cancel_requested_at: Date.now() });
    return true;
  },
});

/** Fresh authority check before claimed worker external work, including temporary
 * and non-checkpoint purposes. Active claims do not expire by startup lease age. */
export const isExecutionCurrent = query({
  args: {
    ...ownerArgs,
    claimId: v.string(),
    runId: v.string(),
    requireChat: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { chat, claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    requireIdentifier(args.runId);
    if (
      claim &&
      ((await readClaimCleanupReceipt(ctx, args, claim))
        ?.cleanup_confirmed_at !== undefined ||
        (await hasPendingHackCleanup(ctx, args, claim.claim_id)))
    )
      return false;
    return (
      !!claim &&
      claim.phase === "active" &&
      claim.claim_id === args.claimId &&
      claim.run_id === args.runId &&
      claim.cancel_requested_at === undefined &&
      (!args.requireChat || !!chat) &&
      (!chat || chat.active_trigger_run_id === args.runId)
    );
  },
});

export const release = mutation({
  args: {
    ...ownerArgs,
    claimId: v.string(),
    runId: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { chat, claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    if (args.runId !== undefined) requireIdentifier(args.runId);
    if (!claim || claim.claim_id !== args.claimId) return false;
    if (claim.run_id !== args.runId) return false;
    if (claim.remote_cleanup_required && !claim.remote_cleanup_confirmed)
      return false;
    if (
      (await readClaimCleanupReceipt(ctx, args, claim))?.cleanup_pending ===
      true
    )
      return false;
    if (
      args.runId === undefined &&
      claim.phase !== "starting" &&
      claim.phase !== "released"
    )
      return false;
    await ctx.db.patch(claim._id, { phase: "released" });
    if (
      args.runId !== undefined &&
      chat?.active_trigger_run_id === args.runId
    ) {
      await ctx.db.patch(chat._id, {
        active_trigger_run_id: undefined,
        last_run_error:
          chat.canceled_at && chat.canceled_at >= claim.started_at
            ? undefined
            : args.failureMessage?.slice(0, 1000),
      });
    }
    return true;
  },
});

/** Registered before tools may start; a terminal worker cannot bypass it. */
export const requireRemoteCleanup = mutation({
  args: { ...ownerArgs, claimId: v.string(), runId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    requireIdentifier(args.runId);
    if (
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.run_id !== args.runId ||
      claim.phase !== "active" ||
      claim.remote_cleanup_confirmed
    )
      return false;
    await ctx.db.patch(claim._id, { remote_cleanup_required: true });
    return true;
  },
});

/** Trusted worker calls only after sealed tools and confirmed remote exits. */
export const confirmRemoteCleanup = mutation({
  args: { ...ownerArgs, claimId: v.string(), runId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    requireIdentifier(args.runId);
    if (
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.run_id !== args.runId ||
      !claim.remote_cleanup_required
    )
      return false;
    if (claim.resource_journal_enabled) {
      // Query each pending state directly: a long history of exited commands
      // must never hide a still-reserved launch behind a pagination limit.
      const pending = await Promise.all(
        (["reserved", "started"] as const).map((state) =>
          ctx.db
            .query("agent_run_resources")
            .withIndex("by_owner_run_state", (q) =>
              q
                .eq("user_id", args.userId)
                .eq("chat_id", args.chatId)
                .eq("claim_id", args.claimId)
                .eq("run_id", args.runId)
                .eq("state", state),
            )
            .take(1),
        ),
      );
      if (pending.some((rows) => rows.length > 0)) return false;
    }
    await ctx.db.patch(claim._id, { remote_cleanup_confirmed: true });
    return true;
  },
});

/** Fence admission and persist the initial turn in one database transaction. */
export const persistInitialTurn = mutation({
  args: {
    ...ownerArgs,
    claimId: v.string(),
    // Derived from the route's server-read snapshot, never request JSON.
    allowCreate: v.boolean(),
    title: v.string(),
    purpose: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    message: v.optional(
      v.object({
        id: v.string(),
        parts: v.array(v.any()),
        fileIds: v.optional(v.array(v.id("files"))),
        isHidden: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { chat, claim } = await readOwned(ctx, args);
    requireIdentifier(args.claimId);
    if (
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.cancel_requested_at !== undefined ||
      claim.phase !== "starting" ||
      claim.run_id !== undefined ||
      chat?.active_trigger_run_id !== claim.expected_chat_run_id
    ) {
      throw new ConvexError({
        code: "AGENT_RUN_LOST",
        message: "This agent start no longer owns the chat.",
      });
    }
    // Like assertAgentRunStartCurrent, a still-current token is not invalidated
    // by lease age alone. This mutation never renews or activates the claim.
    if (!chat && !args.allowCreate)
      throw new ConvexError({
        code: "CHAT_NOT_FOUND",
        message: "This chat no longer exists.",
      });

    const message = args.message;
    let existing: Doc<"messages"> | undefined;
    let fileIds: Id<"files">[] = [];
    let files: Doc<"files">[] = [];
    let content: string | undefined;
    if (message) {
      requireIdentifier(message.id);
      const matches = await ctx.db
        .query("messages")
        .withIndex("by_message_id", (q) => q.eq("id", message.id))
        .take(2);
      existing = matches[0];
      if (
        matches.length > 1 ||
        (existing &&
          (existing.chat_id !== args.chatId ||
            existing.user_id !== args.userId ||
            existing.role !== "user"))
      ) {
        throw new ConvexError({
          code: "MESSAGE_UNAUTHORIZED",
          message: "Message ID is already bound to another message.",
        });
      }
      fileIds = Array.from(
        new Set([
          ...(message.fileIds ?? []),
          ...extractFileIdsFromParts(message.parts),
        ]),
      );
      files = await Promise.all(
        fileIds.map(async (id) => {
          const file = await ctx.db.get(id).catch(() => null);
          if (!file || file.user_id !== args.userId)
            throw new ConvexError({
              code: "FILE_NOT_FOUND_OR_FORBIDDEN",
              message: "Attachment is not available to this user.",
            });
          return file;
        }),
      );
      content = extractTextFromParts(message.parts) || undefined;
    }

    // Reuse saveChat's ownership/project/purpose/retry rules. File and message
    // validation above precedes writes; every write below shares this transaction.
    await saveOwnedChat(ctx, {
      id: args.chatId,
      userId: args.userId,
      title: args.title,
      purpose: args.purpose,
      projectId: args.projectId,
    });
    if (!message) return null;
    if (existing) {
      // A retry never replaces an already-persisted user's content.
      const merged = Array.from(
        new Set([...(existing.file_ids ?? []), ...fileIds]),
      );
      const patch: Partial<Doc<"messages">> = {};
      if (merged.length > (existing.file_ids?.length ?? 0))
        patch.file_ids = merged;
      if (
        message.isHidden !== undefined &&
        message.isHidden !== existing.is_hidden
      )
        patch.is_hidden = message.isHidden;
      if (Object.keys(patch).length)
        await ctx.db.patch(existing._id, { ...patch, update_time: Date.now() });
    } else {
      await ctx.db.insert("messages", {
        id: message.id,
        chat_id: args.chatId,
        user_id: args.userId,
        role: "user",
        parts: message.parts,
        content,
        file_ids: fileIds.length ? fileIds : undefined,
        is_hidden: message.isHidden,
        update_time: Date.now(),
      });
    }
    for (const file of files) {
      if (!file.is_attached)
        await ctx.db.patch(file._id, { is_attached: true });
    }
    return null;
  },
});
