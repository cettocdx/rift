import { providerReceiptUsage } from "./lib/providerReceipt";
import { githubRepositoryValidator } from "./lib/githubRepository";
import {
  productionCreditBinding,
  productionCreditDenial,
} from "./lib/accountCreditProductionAdmission";
import { storedTerminalCreditSettlement } from "./lib/accountCreditSettlement";
import {
  accountCreditReceipt,
  accountCreditReservationState,
} from "./lib/accountCreditReservation";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const encryptedMcpSecret = v.object({
  version: v.literal(1),
  algorithm: v.literal("aes-256-gcm"),
  keyVersion: v.string(),
  iv: v.string(),
  ciphertext: v.string(),
  authTag: v.string(),
});

const dispatchAdmissionFields = {
  user_id: v.string(),
  chat_id: v.string(),
  dispatch_id: v.string(),
  attempt_id: v.string(),
  phase: v.union(
    v.literal("elected"),
    v.literal("attached"),
    v.literal("dispatching"),
    v.literal("released"),
    v.literal("revoked"),
  ),
  previous_claim_id: v.union(v.string(), v.null()),
  previous_run_id: v.optional(v.string()),
  previous_chat_run_id: v.optional(v.string()),
  next_claim_id: v.string(),
  payload_hash: v.string(),
  request_message_id: v.string(),
  fingerprint_version: v.literal(1),
  replace_active_run: v.boolean(),
  // Captured by trusted dedicated Hack admission; never a client capability.
  requires_cleanup: v.optional(v.boolean()),
  created_at: v.number(),
  cancellation_authorized_at: v.optional(v.number()),
};

export default defineSchema({
  tool_approvals: defineTable({
    userId: v.string(),
    chatId: v.string(),
    runId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    preview: v.string(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("consumed"),
      v.literal("canceled"),
    ),
  }).index("by_owner_chat_status", ["userId", "chatId", "status"]),
  // Convex Auth tables (users, authAccounts, authSessions, ...)
  ...authTables,
  // One durable startup/active claim per logical chat, including temporary
  // chats that deliberately have no chats row. Claim IDs fence delayed workers.
  agent_run_claims: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    claim_id: v.string(),
    phase: v.union(
      v.literal("starting"),
      v.literal("active"),
      v.literal("released"),
    ),
    run_id: v.optional(v.string()),
    started_at: v.number(),
    lease_until: v.number(),
    expected_chat_run_id: v.optional(v.string()),
    // Exact durable request identity; absent on legacy claims.
    dispatch_id: v.optional(v.string()),
    // Sticky for this claim generation, even if transient stream state clears.
    cancel_requested_at: v.optional(v.number()),
    remote_cleanup_required: v.optional(v.boolean()),
    remote_cleanup_confirmed: v.optional(v.boolean()),
    resource_journal_enabled: v.optional(v.boolean()),
  }).index("by_chat_id", ["chat_id"]),
  // Launch intent survives worker loss; a reserved operation is still uncertain.
  agent_run_resources: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    claim_id: v.string(),
    run_id: v.string(),
    resource_id: v.string(),
    sandbox_id: v.string(),
    kind: v.literal("foreground_command"),
    state: v.union(
      v.literal("reserved"),
      v.literal("started"),
      v.literal("exited"),
      v.literal("not_started"),
      v.literal("sandbox_absent"),
    ),
    pid: v.optional(v.number()),
    process_identity: v.optional(v.string()),
    absence_verified_at: v.optional(v.number()),
    created_at: v.number(),
    started_at: v.optional(v.number()),
    exited_at: v.optional(v.number()),
  })
    .index("by_resource_id", ["resource_id"])
    .index("by_owner_run_state", [
      "user_id",
      "chat_id",
      "claim_id",
      "run_id",
      "state",
    ]),
  // Admission ownership does not activate or replace an execution claim. Intents
  // survive reuse of the per-chat gate, preventing replay after Stop/completion.
  agent_dispatch_admissions: defineTable(dispatchAdmissionFields).index(
    "by_chat_id",
    ["chat_id"],
  ),
  agent_dispatch_intents: defineTable(dispatchAdmissionFields).index(
    "by_owner_chat_dispatch",
    ["user_id", "chat_id", "dispatch_id"],
  ),
  // A Stop can precede admission and even chat persistence. These compact fences
  // are permanent: deleting by age would allow a delayed POST to run again.
  agent_dispatch_stops: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    dispatch_id: v.string(),
    requested_at: v.number(),
  }).index("by_owner_chat_dispatch", ["user_id", "chat_id", "dispatch_id"]),
  // Persistent Hack HTTP execution identity exists before chat persistence.
  // Stop/terminal records cannot expire while delayed admission is still valid.
  hack_http_executions: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    execution_id: v.string(),
    phase: v.union(
      v.literal("stopped"),
      v.literal("admitted"),
      v.literal("running"),
      v.literal("terminal"),
    ),
    created_at: v.number(),
    admitted_at: v.optional(v.number()),
    running_at: v.optional(v.number()),
    terminal_at: v.optional(v.number()),
    stop_requested_at: v.optional(v.number()),
    discard: v.optional(v.boolean()),
  }).index("by_owner_chat_execution", ["user_id", "chat_id", "execution_id"]),
  hack_http_execution_heads: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    execution_id: v.string(),
  }).index("by_chat_id", ["chat_id"]),
  // Logical dispatch receipts survive replacement of the per-chat worker claim.
  // Metadata only: never store request content, local paths or public tokens.
  agent_dispatch_requests: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    client_dispatch_id: v.string(),
    request_message_id: v.string(),
    payload_hash: v.string(),
    fingerprint_version: v.literal(1),
    claim_id: v.string(),
    state: v.union(
      v.literal("reserved"),
      v.literal("dispatching"),
      v.literal("accepted"),
      v.literal("terminal"),
    ),
    run_id: v.optional(v.string()),
    created_at: v.number(),
    dispatch_started_at: v.optional(v.number()),
    // Original server attempt confirmed that Trigger was never invoked.
    not_dispatched_at: v.optional(v.number()),
    requires_cleanup: v.optional(v.boolean()),
    // Separate from Trigger status: remote effects can outlive its worker.
    cleanup_pending: v.optional(v.boolean()),
    cleanup_confirmed_at: v.optional(v.number()),
    worker_lifecycle_version: v.optional(v.literal(1)),
    worker_entry_id: v.optional(v.string()),
    worker_effects_started_at: v.optional(v.number()),
    worker_pre_execution_cleanup_at: v.optional(v.number()),
    accepted_at: v.optional(v.number()),
    terminal_at: v.optional(v.number()),
    terminal_status: v.optional(
      v.union(
        v.literal("COMPLETED"),
        v.literal("CANCELED"),
        v.literal("FAILED"),
        v.literal("CRASHED"),
        v.literal("SYSTEM_FAILURE"),
        v.literal("EXPIRED"),
        v.literal("TIMED_OUT"),
      ),
    ),
  })
    .index("by_owner_chat_dispatch", [
      "user_id",
      "chat_id",
      "client_dispatch_id",
    ])
    .index("by_chat_cleanup_pending", ["chat_id", "cleanup_pending"]),
  // Canonical completed model steps. Unlike run_events, writes are required
  // before advancing the loop; a newer in-flight marker forbids blind replay.
  agent_checkpoints: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    claim_id: v.string(),
    run_id: v.string(),
    request_message_id: v.string(),
    request_hash: v.string(),
    model: v.string(),
    status: v.union(v.literal("active"), v.literal("finished")),
    checkpoint: v.optional(
      v.object({
        version: v.literal(1),
        stepIndex: v.number(),
        finishReason: v.string(),
        messagesJson: v.string(),
      }),
    ),
    in_flight_step_index: v.optional(v.number()),
    execution_tracking: v.optional(v.literal(1)),
    // Set only by workers with complete inbox/checkpoint/transcript support.
    steering_enabled: v.optional(v.literal(1)),
    // Next unused sequence for the original logical request, starting at 1.
    steering_next_sequence: v.optional(v.number()),
    // Exact step membership, including an empty reservation. Intake identities
    // on agent_run_inputs remain immutable when this checkpoint is recovered.
    steering_prepared_step: v.optional(
      v.object({
        step_index: v.number(),
        claim_id: v.string(),
        run_id: v.string(),
        input_ids: v.array(v.id("agent_run_inputs")),
        // Only needed before the first completed checkpoint exists.
        initial_messages_json: v.optional(v.string()),
      }),
    ),
    executing_step_index: v.optional(v.number()),
    blocked_reason: v.optional(v.string()),
    update_time: v.number(),
  }).index("by_chat_id", ["chat_id"]),
  // Durable steering receipts. Intake target identities remain immutable;
  // later reservations are fenced by the current original-request checkpoint.
  agent_run_inputs: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    request_message_id: v.string(),
    request_hash: v.string(),
    claim_id: v.string(),
    run_id: v.string(),
    client_request_id: v.string(),
    payload_hash: v.string(),
    text: v.string(),
    sequence: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("reserved"),
      v.literal("applied"),
      v.literal("undelivered"),
    ),
    accepted_at: v.number(),
    reserved_step_index: v.optional(v.number()),
    after_response_message_count: v.optional(v.number()),
    applied_step_index: v.optional(v.number()),
  })
    .index("by_owner_chat_client_request", [
      "user_id",
      "chat_id",
      "client_request_id",
    ])
    .index("by_request_sequence", [
      "user_id",
      "chat_id",
      "request_message_id",
      "request_hash",
      "sequence",
    ])
    .index("by_request_status", [
      "user_id",
      "chat_id",
      "request_message_id",
      "request_hash",
      "status",
      "sequence",
    ]),
  chats: defineTable({
    id: v.string(),
    title: v.string(),
    user_id: v.string(),
    finish_reason: v.optional(v.string()),
    active_stream_id: v.optional(v.string()),
    active_http_execution_id: v.optional(v.string()),
    active_trigger_run_id: v.optional(v.string()),
    last_run_error: v.optional(v.string()),
    opencode_session_id: v.optional(v.string()),
    opencode_sandbox_id: v.optional(v.string()),
    canceled_at: v.optional(v.number()),
    // Whether the cancellation that set canceled_at intends to DISCARD the
    // partial output (regenerate / edit / retry) rather than keep it (a plain
    // Stop). This intent used to travel only over a Redis pub/sub message, so a
    // dropped message left the producer unable to tell the two apart -- and it
    // defaulted to discarding, which lost the user's partial output. Persisting
    // it here makes the decision durable.
    cancel_skip_save: v.optional(v.boolean()),
    default_model_slug: v.optional(
      v.union(v.literal("ask"), v.literal("agent"), v.literal("agent-long")),
    ),
    todos: v.optional(
      v.array(
        v.object({
          id: v.string(),
          content: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed"),
            v.literal("cancelled"),
          ),
          sourceMessageId: v.optional(v.string()),
        }),
      ),
    ),
    branched_from_chat_id: v.optional(v.string()),
    latest_summary_id: v.optional(v.id("chat_summaries")),
    update_time: v.number(),
    // Sharing fields
    share_id: v.optional(v.string()),
    share_date: v.optional(v.number()),
    pinned_at: v.optional(v.number()),
    sandbox_type: v.optional(v.string()),
    selected_model: v.optional(v.string()),
    // What the agent is for: "security" (default, offensive-security agent) or
    // "app" (Claude-Code-style app/game builder). Additive + optional so old
    // rows validate unchanged; absence means "security".
    purpose: v.optional(v.string()),
    console_session: v.optional(v.boolean()),
    // Optional server-validated project binding. Legacy chats remain unbound.
    project_id: v.optional(v.id("projects")),
    project_bot_id: v.optional(v.id("project_bots")),
    bot_meeting_id: v.optional(v.id("bot_meetings")),
    // Legacy field retained on historical rows. The local-provider feature
    // was removed and nothing reads or writes this anymore — kept in the
    // schema so old rows still pass validation.
    codex_thread_id: v.optional(v.string()),
  })
    .index("by_chat_id", ["id"])
    .index("by_user_and_updated", ["user_id", "update_time"])
    .index("by_user_and_project_and_updated", [
      "user_id",
      "project_id",
      "update_time",
    ])
    .index("by_user_and_pinned", ["user_id", "pinned_at"])
    .index("by_share_id", ["share_id"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["user_id"],
    }),

  chat_summaries: defineTable({
    chat_id: v.string(),
    summary_text: v.string(),
    summary_up_to_message_id: v.string(),
    summary_up_to_message_creation_time: v.optional(v.number()),
    previous_summaries: v.optional(
      v.array(
        v.object({
          summary_text: v.string(),
          summary_up_to_message_id: v.string(),
          summary_up_to_message_creation_time: v.optional(v.number()),
        }),
      ),
    ),
  }).index("by_chat_id", ["chat_id"]),

  messages: defineTable({
    id: v.string(),
    chat_id: v.string(),
    user_id: v.string(),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    parts: v.array(v.any()),
    content: v.optional(v.string()),
    file_ids: v.optional(v.array(v.id("files"))),
    feedback_id: v.optional(v.id("feedback")),
    source_message_id: v.optional(v.string()),
    update_time: v.number(),
    model: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("agent"), v.literal("ask"))),
    generation_started_at: v.optional(v.number()),
    generation_time_ms: v.optional(v.number()),
    finish_reason: v.optional(v.string()),
    // Durable record that a run was stopped, independent of the chat's
    // transient `canceled_at` which both completion paths clear. Without it a
    // stopped turn is indistinguishable from a finished one after the fact.
    stop_reason: v.optional(v.string()),
    usage: v.optional(v.any()),
    is_hidden: v.optional(v.boolean()),
  })
    .index("by_message_id", ["id"])
    .index("by_chat_id", ["chat_id"])
    .index("by_feedback_id", ["feedback_id"])
    .index("by_user_id", ["user_id"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["user_id"],
    }),

  // ---------------------------------------------------------------------------
  // Run / RunEvent / evidence
  //
  // Before these, a chat message row was the only durable object an agent run
  // produced. There was no way to ask "what did that run actually do", and the
  // evidence a run gathered lived inside the message it happened to be attached
  // to -- so compaction, which shrinks that message to fit Convex's 1 MiB
  // document cap, destroyed it. These three tables give a run its own identity,
  // an ordered log of what it did, and a place for evidence to live that does
  // not compete with the message for the same 1 MiB.
  //
  // Every write to them is best-effort: a run is a record OF the work, never a
  // precondition FOR it, so a failure here must never break a chat.
  // ---------------------------------------------------------------------------
  runs: defineTable({
    id: v.string(),
    chat_id: v.string(),
    user_id: v.string(),
    // Free-form so the canonical vocabulary in lib/runs/run-status.ts can grow
    // without a migration. Readers narrow it with `toRunStatus`, which maps an
    // unrecognised value to `disconnected` rather than guessing an outcome.
    status: v.string(),
    mode: v.optional(v.string()),
    purpose: v.optional(v.string()),
    /** Which product surface ran this: build | studio | hack | task. */
    surface: v.optional(v.string()),
    /** What the user asked for, in their words. Shown on the Run card. */
    goal: v.optional(v.string()),
    /** Coarse progress label, e.g. the active Hack phase. */
    phase: v.optional(v.string()),
    /** Dollars this run actually cost, once known. */
    cost_dollars: v.optional(v.number()),
    total_tokens: v.optional(v.number()),
    /** Durable artifacts this run produced. */
    output_count: v.optional(v.number()),
    model: v.optional(v.string()),
    /** Assistant message this run produced, when one exists. */
    message_id: v.optional(v.string()),
    started_at: v.number(),
    ended_at: v.optional(v.number()),
    /** "user" when the operator stopped it. Mirrors messages.stop_reason. */
    stop_reason: v.optional(v.string()),
    finish_reason: v.optional(v.string()),
    error: v.optional(v.string()),
    update_time: v.number(),
    /** Aggregate measurements, written when the run closes. */
    metrics: v.optional(v.any()),
    /** sha256 of the assembled system prompt, for replay and drift tracking. */
    prompt_hash: v.optional(v.string()),
  })
    .index("by_run_id", ["id"])
    .index("by_chat_id", ["chat_id"])
    .index("by_user_id", ["user_id"])
    .index("by_started_at", ["started_at"])
    // Open-run reporting by status and start time; age is not termination proof.
    .index("by_status_started", ["status", "started_at"]),

  run_events: defineTable({
    run_id: v.string(),
    chat_id: v.string(),
    user_id: v.string(),
    /** Monotonic within a run, so the log has a stable order independent of time. */
    seq: v.number(),
    type: v.string(),
    at: v.number(),
    tool_call_id: v.optional(v.string()),
    tool_name: v.optional(v.string()),
    /** One human-readable line. The log stays readable without opening evidence. */
    summary: v.optional(v.string()),
    evidence_id: v.optional(v.id("evidence")),
    severity: v.optional(v.string()),
    exit_code: v.optional(v.number()),
    duration_ms: v.optional(v.number()),
    // Per-step accounting and replay hooks. All optional: older rows and the
    // terminal-command events that predate them stay valid.
    step_index: v.optional(v.number()),
    input_tokens: v.optional(v.number()),
    output_tokens: v.optional(v.number()),
    reasoning_tokens: v.optional(v.number()),
    cache_read_tokens: v.optional(v.number()),
    cost_dollars: v.optional(v.number()),
    /** "ok" | "error" for tool/step events. */
    status: v.optional(v.string()),
    /** sha256 of the tool's canonical input; what a replay keys on. */
    input_hash: v.optional(v.string()),
    output_bytes: v.optional(v.number()),
  })
    .index("by_run_id", ["run_id", "seq"])
    .index("by_chat_id", ["chat_id"]),

  evidence: defineTable({
    chat_id: v.string(),
    user_id: v.string(),
    run_id: v.optional(v.string()),
    tool_call_id: v.optional(v.string()),
    /** "terminal_output" | "tool_output" | "finding" */
    kind: v.string(),
    content: v.string(),
    /** True when `content` was capped; byte_size is the pre-cap size. */
    truncated: v.optional(v.boolean()),
    byte_size: v.number(),
    command: v.optional(v.string()),
    cwd: v.optional(v.string()),
    exit_code: v.optional(v.number()),
    started_at: v.optional(v.number()),
    ended_at: v.optional(v.number()),
    duration_ms: v.optional(v.number()),
    created_at: v.number(),
  })
    .index("by_chat_id", ["chat_id"])
    .index("by_run_id", ["run_id"])
    .index("by_tool_call_id", ["tool_call_id"]),

  files: defineTable({
    // Legacy field for Convex storage (existing files)
    storage_id: v.optional(v.id("_storage")),
    // New field for S3 storage
    s3_key: v.optional(v.string()),
    user_id: v.string(),
    name: v.string(),
    media_type: v.string(),
    size: v.number(),
    file_token_size: v.number(),
    content: v.optional(v.string()),
    is_attached: v.boolean(),
    // Lineage for a generated asset: what it was made from. A generated image
    // used to be an anonymous file -- section 24.5 asks every output to retain
    // its prompt, model, settings, cost and source run so it can be traced,
    // reproduced and attributed. Absent on uploaded (non-generated) files.
    generation: v.optional(
      v.object({
        prompt: v.string(),
        model: v.string(),
        surface: v.optional(v.string()),
        settings: v.optional(v.any()),
        cost_dollars: v.optional(v.number()),
        run_id: v.optional(v.string()),
        created_at: v.number(),
      }),
    ),
  })
    .index("by_user_id", ["user_id"])
    .index("by_is_attached", ["is_attached"])
    .index("by_s3_key", ["s3_key"])
    .index("by_storage_id", ["storage_id"]),

  feedback: defineTable({
    feedback_type: v.union(v.literal("positive"), v.literal("negative")),
    feedback_details: v.optional(v.string()),
  }),

  user_customization: defineTable({
    user_id: v.string(),
    nickname: v.optional(v.string()),
    occupation: v.optional(v.string()),
    personality: v.optional(v.string()),
    traits: v.optional(v.string()),
    additional_info: v.optional(v.string()),
    updated_at: v.number(),
    include_memory_entries: v.optional(v.boolean()),
    guardrails_config: v.optional(v.string()),
    caido_enabled: v.optional(v.boolean()),
    caido_port: v.optional(v.number()),
    extra_usage_enabled: v.optional(v.boolean()),
    // Legacy MAX Mode flag retained on historical rows. The feature was
    // removed and nothing reads or writes this anymore — kept in the schema
    // so old rows still pass validation.
    max_mode_enabled: v.optional(v.boolean()),
  }).index("by_user_id", ["user_id"]),

  // Extra usage (created when user enables extra usage)
  // Note: Most monetary values stored in POINTS for precision (1 point = $0.0001, matching rate limiting)
  // This avoids precision loss when deducting sub-cent amounts from balance.
  // Exception: auto_reload_amount_dollars is stored in dollars since it's used directly for Stripe charges.
  extra_usage: defineTable({
    user_id: v.string(),
    balance_points: v.number(),
    // Per-user Stripe customer for pay-as-you-go token purchases. Lazily
    // created on first checkout (see extraUsageActions.getStripeCustomerId).
    stripe_customer_id: v.optional(v.string()),
    auto_reload_enabled: v.optional(v.boolean()),
    auto_reload_threshold_points: v.optional(v.number()),
    auto_reload_amount_dollars: v.optional(v.number()), // Stored in dollars for Stripe
    monthly_cap_points: v.optional(v.number()),
    monthly_spent_points: v.optional(v.number()),
    monthly_reset_date: v.optional(v.string()),
    // Legacy trust-cap fields retained so old rows still pass validation.
    // The trust-cap feature no longer reads or writes these values.
    first_successful_charge_at: v.optional(v.number()),
    cumulative_spend_dollars: v.optional(v.number()),
    override_monthly_cap_dollars: v.optional(v.number()),
    // Auto-reload health tracking — disable after consecutive failures so a
    // broken saved card does not keep retrying.
    auto_reload_consecutive_failures: v.optional(v.number()),
    auto_reload_disabled_reason: v.optional(v.string()),
    // Lifetime gate: set true once the user spends their one free Agent run.
    // Legacy — retained so old rows validate. Superseded by free_agent_run_month
    // (monthly gate): free users now get one free Agent run per calendar month.
    free_agent_run_used: v.optional(v.boolean()),
    // YYYY-MM in which the user spent their free Agent run; resets monthly.
    free_agent_run_month: v.optional(v.string()),
    // Monthly subscription allowance (Pro/Max). Granted points are "included"
    // usage that resets each calendar month and is consumed BEFORE the purchased
    // balance_points. Set by the LemonSqueezy webhook on each successful payment;
    // zeroed on cancel/expire.
    monthly_granted_points: v.optional(v.number()),
    monthly_granted_used_points: v.optional(v.number()),
    monthly_granted_reset_date: v.optional(v.string()),
    // Provider billing-cycle identity. Unlike monthly_granted_reset_date
    // (legacy YYYY-MM), this key changes only for a genuinely new paid cycle,
    // so duplicate or out-of-order webhook deliveries cannot mint credits.
    monthly_granted_cycle_key: v.optional(v.string()),
    // Provider timestamp for the cycle-opening invoice. This monotonic guard
    // prevents a delayed older invoice from resetting a newer credit cycle.
    monthly_granted_cycle_started_at: v.optional(v.string()),
    // ISO timestamp supplied by the subscription provider for display and
    // warning copy. Authorization never resets based on the local calendar.
    monthly_granted_resets_at: v.optional(v.string()),
    // One-time cutover marker from the retired Redis paid-plan bucket. The
    // migration mutation folds the old bucket's consumed amount into
    // monthly_granted_used_points exactly once before Redis is deleted.
    legacy_redis_migration_key: v.optional(v.string()),
    legacy_redis_consumed_points: v.optional(v.number()),
    // Actual post-stream cost that exceeded both included and purchased
    // credits. New work is blocked until a top-up or renewal settles it.
    credit_debt_points: v.optional(v.number()),
    credit_accounting_generation: v.optional(v.number()),
    updated_at: v.number(),
  })
    .index("by_user_id", ["user_id"])
    .index("by_stripe_customer_id", ["stripe_customer_id"]),

  // Additive backend primitive. Production callers are not migrated yet.
  account_credit_reservations: defineTable({
    reservation_key: v.string(),
    user_id: v.string(),
    amount_points: v.number(),
    subscription: v.union(v.literal("pro"), v.literal("ultra")),
    state: accountCreditReservationState,
    receipt: v.optional(accountCreditReceipt),
    accounting_generation: v.number(),
    terminal_settlement: v.optional(storedTerminalCreditSettlement),
    production_admission: v.optional(productionCreditBinding),
    admission_denial: v.optional(
      v.object({ reason: productionCreditDenial, at: v.number() }),
    ),
    ledger_id: v.optional(v.id("extra_usage")),
    included_cycle_key: v.optional(v.string()),
    included_cycle_month: v.optional(v.string()),
    purchased_month: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_reservation_key", ["reservation_key"])
    .index("by_state_updated_at", ["state", "updated_at"]),

  // Display correlation only. The existing credit ledger remains authoritative.
  console_usage_operations: defineTable({
    user_id: v.string(),
    session_id: v.string(),
    operation_id: v.string(),
    reservation_key: v.string(),
    created_at: v.number(),
  })
    .index("by_owner_operation", ["user_id", "operation_id"])
    .index("by_owner_session", ["user_id", "session_id"]),

  // Idempotency guard for exact-source credit refunds. A failed request may
  // traverse more than one error handler, but its expiring and purchased
  // credits must be restored only once.
  processed_credit_refunds: defineTable({
    refund_key: v.string(),
    user_id: v.string(),
    processed_at: v.number(),
  }).index("by_refund_key", ["refund_key"]),

  // Active paid subscriptions (Pro / Max) via LemonSqueezy. One row per user's
  // current subscription; the LemonSqueezy webhook upserts it. resolveSubscription
  // Tier reads the derived tier through getActiveSubscription → useAuth entitlements.
  subscriptions: defineTable({
    user_id: v.string(),
    provider: v.string(), // "lemonsqueezy"
    ls_subscription_id: v.string(),
    ls_customer_id: v.optional(v.string()),
    ls_variant_id: v.optional(v.string()),
    ls_order_id: v.optional(v.string()),
    // RIFT tier: "pro" (RIFT Pro) or "ultra" (RIFT Max — maps to the existing
    // top consumer tier in SubscriptionTier).
    tier: v.string(),
    // LemonSqueezy status: active | on_trial | paused | past_due | unpaid |
    // cancelled | expired. Only active/on_trial/past_due grant entitlements.
    status: v.string(),
    renews_at: v.optional(v.string()),
    ends_at: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_id", ["user_id"])
    .index("by_ls_subscription_id", ["ls_subscription_id"]),

  // Team-shared extra usage pool. Admin funds it; any member of the org draws
  // from it for overflow once the team subscription bucket is exhausted.
  // Same units as extra_usage (points; auto-reload amount in dollars).
  team_extra_usage: defineTable({
    organization_id: v.string(),
    enabled: v.optional(v.boolean()),
    balance_points: v.number(),
    auto_reload_enabled: v.optional(v.boolean()),
    auto_reload_threshold_points: v.optional(v.number()),
    auto_reload_amount_dollars: v.optional(v.number()),
    monthly_cap_points: v.optional(v.number()),
    monthly_spent_points: v.optional(v.number()),
    monthly_reset_date: v.optional(v.string()),
    // Legacy trust-cap fields retained so old rows still pass validation.
    // The trust-cap feature no longer reads or writes these values.
    first_successful_charge_at: v.optional(v.number()),
    cumulative_spend_dollars: v.optional(v.number()),
    override_monthly_cap_dollars: v.optional(v.number()),
    auto_reload_consecutive_failures: v.optional(v.number()),
    auto_reload_disabled_reason: v.optional(v.string()),
    updated_at: v.number(),
  }).index("by_org", ["organization_id"]),

  // Per-member usage tracking and admin-set limits within the team pool.
  // monthly_limit_points = null means no per-member cap (only team cap applies).
  // disabled = true blocks the member entirely from drawing on the team pool.
  team_member_usage: defineTable({
    organization_id: v.string(),
    user_id: v.string(),
    monthly_limit_points: v.optional(v.number()),
    monthly_spent_points: v.optional(v.number()),
    monthly_reset_date: v.optional(v.string()),
    disabled: v.optional(v.boolean()),
    updated_at: v.number(),
  })
    .index("by_org", ["organization_id"])
    .index("by_org_user", ["organization_id", "user_id"]),

  referral_codes: defineTable({
    user_id: v.string(),
    code: v.string(),
    status: v.union(v.literal("active"), v.literal("deactivated")),
    referrer_subscription_tier: v.optional(
      v.union(
        v.literal("pro"),
        v.literal("pro-plus"),
        v.literal("ultra"),
        v.literal("team"),
      ),
    ),
    referrer_organization_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
    deactivated_at: v.optional(v.number()),
    deactivated_reason: v.optional(v.string()),
  })
    .index("by_user_id", ["user_id"])
    .index("by_code", ["code"]),

  referral_attributions: defineTable({
    referred_user_id: v.string(),
    referrer_user_id: v.string(),
    referral_code: v.string(),
    referrer_subscription_tier: v.optional(
      v.union(
        v.literal("pro"),
        v.literal("pro-plus"),
        v.literal("ultra"),
        v.literal("team"),
      ),
    ),
    referrer_organization_id: v.optional(v.string()),
    status: v.union(v.literal("attributed"), v.literal("converted")),
    signup_bonus_units: v.optional(v.number()),
    sign_up_reward_status: v.union(
      v.literal("none"),
      v.literal("awarded"),
      v.literal("withheld"),
    ),
    conversion_reward_status: v.union(
      v.literal("pending"),
      v.literal("awarded"),
      v.literal("withheld"),
    ),
    source: v.optional(v.string()),
    stripe_checkout_session_id: v.optional(v.string()),
    stripe_customer_id: v.optional(v.string()),
    stripe_subscription_id: v.optional(v.string()),
    stripe_invoice_id: v.optional(v.string()),
    requested_plan: v.optional(v.string()),
    converted_tier: v.optional(
      v.union(
        v.literal("pro"),
        v.literal("pro-plus"),
        v.literal("ultra"),
        v.literal("team"),
      ),
    ),
    created_at: v.number(),
    updated_at: v.number(),
    converted_at: v.optional(v.number()),
    withheld_reason: v.optional(v.string()),
  })
    .index("by_referred_user_id", ["referred_user_id"])
    .index("by_referrer_user_id", ["referrer_user_id"])
    .index("by_referral_code", ["referral_code"])
    .index("by_stripe_checkout_session_id", ["stripe_checkout_session_id"])
    .index("by_stripe_customer_id", ["stripe_customer_id"])
    .index("by_stripe_subscription_id", ["stripe_subscription_id"]),

  referral_rewards: defineTable({
    idempotency_key: v.string(),
    reward_type: v.union(
      v.literal("referred_signup"),
      v.literal("referrer_conversion"),
    ),
    status: v.union(v.literal("awarded"), v.literal("withheld")),
    user_id: v.optional(v.string()),
    referrer_user_id: v.optional(v.string()),
    referred_user_id: v.optional(v.string()),
    referral_code: v.optional(v.string()),
    amount_dollars: v.number(),
    amount_units: v.optional(v.number()),
    reason: v.optional(v.string()),
    stripe_checkout_session_id: v.optional(v.string()),
    stripe_customer_id: v.optional(v.string()),
    stripe_subscription_id: v.optional(v.string()),
    stripe_invoice_id: v.optional(v.string()),
    created_at: v.number(),
    notification_seen_at: v.optional(v.number()),
  })
    .index("by_idempotency_key", ["idempotency_key"])
    .index("by_referrer_user_id", ["referrer_user_id"])
    .index("by_referred_user_id", ["referred_user_id"]),

  user_suspensions: defineTable({
    user_id: v.string(),
    status: v.union(v.literal("active"), v.literal("resolved")),
    category: v.union(
      v.literal("early_fraud_warning"),
      v.literal("dispute_fraudulent"),
      v.literal("dispute_billing_hold"),
    ),
    source: v.literal("stripe"),
    source_id: v.string(),
    source_reason: v.optional(v.string()),
    stripe_customer_id: v.string(),
    stripe_charge_id: v.optional(v.string()),
    organization_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
    source_created_at: v.optional(v.number()),
    resolved_at: v.optional(v.number()),
    resolved_reason: v.optional(v.string()),
  })
    .index("by_user_and_status", ["user_id", "status"])
    .index("by_user_status_source_created", [
      "user_id",
      "status",
      "source_created_at",
    ])
    .index("by_user_and_source", ["user_id", "source_id"])
    .index("by_customer_and_status", ["stripe_customer_id", "status"]),

  memories: defineTable({
    user_id: v.string(),
    memory_id: v.string(),
    content: v.string(),
    update_time: v.number(),
    tokens: v.number(),
  })
    .index("by_memory_id", ["memory_id"])
    .index("by_user_and_update_time", ["user_id", "update_time"]),

  notes: defineTable({
    user_id: v.string(),
    note_id: v.string(),
    title: v.string(),
    content: v.string(),
    category: v.union(
      v.literal("general"),
      v.literal("findings"),
      v.literal("methodology"),
      v.literal("questions"),
      v.literal("plan"),
    ),
    tags: v.array(v.string()),
    tokens: v.number(),
    updated_at: v.number(),
  })
    .index("by_note_id", ["note_id"])
    .index("by_user_and_category", ["user_id", "category"])
    .index("by_user_and_updated", ["user_id", "updated_at"])
    .searchIndex("search_notes", {
      searchField: "content",
      filterFields: ["user_id", "category"],
    }),

  temp_streams: defineTable({
    chat_id: v.string(),
    user_id: v.string(),
  }).index("by_chat_id", ["chat_id"]),

  // Local Sandbox Tables
  local_sandbox_tokens: defineTable({
    user_id: v.string(),
    token: v.string(),
    token_created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_id", ["user_id"])
    .index("by_token", ["token"]),

  local_sandbox_connections: defineTable({
    user_id: v.string(),
    connection_id: v.string(),
    connection_name: v.string(),
    container_id: v.optional(v.string()),
    client_version: v.string(),
    mode: v.union(v.literal("docker"), v.literal("dangerous")),
    os_info: v.optional(
      v.object({
        platform: v.string(),
        arch: v.string(),
        release: v.string(),
        hostname: v.string(),
      }),
    ),
    capabilities: v.optional(
      v.object({
        commands: v.boolean(),
        pty: v.boolean(),
        commandReadiness: v.optional(v.boolean()),
      }),
    ),
    last_heartbeat: v.number(),
    status: v.union(v.literal("connected"), v.literal("disconnected")),
    created_at: v.number(),
    // Set whenever status flips to "disconnected" so refresh-time errors can
    // report the cause (presence sweep, token regen, desktop kick, etc.) and
    // the lag between disconnect and the failed refresh attempt.
    disconnected_at: v.optional(v.number()),
    disconnect_reason: v.optional(
      v.union(
        v.literal("client_disconnect"),
        v.literal("desktop_disconnect"),
        v.literal("desktop_kicked_by_new_session"),
        v.literal("token_regenerated"),
        v.literal("presence_sweep"),
      ),
    ),
  })
    .index("by_user_id", ["user_id"])
    .index("by_connection_id", ["connection_id"])
    .index("by_user_and_status", ["user_id", "status"])
    .index("by_status_and_created_at", ["status", "created_at"]),

  // Per-request usage logs for the usage dashboard
  // Observed provider spend, not a debit authorization or payment receipt.
  provider_usage_receipts: defineTable({
    receipt_id: v.string(),
    user_id: v.string(),
    run_id: v.string(),
    chat_id: v.optional(v.string()),
    model: v.string(),
    usage: providerReceiptUsage,
    observed_at: v.number(),
  })
    .index("by_receipt_id", ["receipt_id"])
    .index("by_user_run", ["user_id", "run_id"]),

  // Outcome evidence for legacy unkeyed adjustments; never permission to replay.
  usage_settlements: defineTable({
    user_id: v.string(),
    chat_id: v.optional(v.string()),
    operation_id: v.optional(v.string()),
    actual_points: v.optional(v.number()),
    run_id: v.string(),
    attempt_id: v.string(),
    evidence: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("acknowledged"),
      v.literal("uncertain"),
    ),
    created_at: v.number(),
    completed_at: v.optional(v.number()),
  })
    .index("by_user_run", ["user_id", "run_id"])
    .index("by_user_chat", ["user_id", "chat_id"])
    .index("by_state_created", ["state", "created_at"]),

  usage_logs: defineTable({
    user_id: v.string(),
    organization_id: v.optional(v.string()),
    chat_id: v.optional(v.string()),
    endpoint: v.optional(
      v.union(
        v.literal("/api/chat"),
        v.literal("/api/agent-long"),
        v.literal("/api/hack-long"),
        v.literal("/api/console/model"),
      ),
    ),
    mode: v.optional(v.union(v.literal("ask"), v.literal("agent"))),
    subscription: v.optional(v.string()),
    model: v.string(),
    type: v.union(v.literal("included"), v.literal("extra")),
    input_tokens: v.number(),
    output_tokens: v.number(),
    cache_read_tokens: v.optional(v.number()),
    cache_write_tokens: v.optional(v.number()),
    total_tokens: v.number(),
    cost_dollars: v.number(),
    model_cost_dollars: v.optional(v.number()),
    non_model_cost_dollars: v.optional(v.number()),
    cost_source: v.optional(
      v.union(v.literal("provider"), v.literal("token_estimate")),
    ),
    // Legacy MAX Mode flag retained on historical rows. The feature was
    // removed and nothing reads or writes this anymore — kept in the schema
    // so old rows still pass validation.
    max_mode: v.optional(v.boolean()),
    // Legacy BYOK flag retained on historical rows. The feature was removed
    // and nothing reads or writes this anymore — kept in the schema so old
    // rows still pass validation.
    byok: v.optional(v.boolean()),
  })
    .index("by_user", ["user_id"])
    .index("by_user_and_model", ["user_id", "model"])
    .index("by_org", ["organization_id"]),

  // Durable revenue ledger for unit economics reporting. Revenue is stored as
  // gross/net dollars because usage costs are sub-cent dollar values already.
  revenue_events: defineTable({
    entity_type: v.union(v.literal("user"), v.literal("organization")),
    entity_id: v.string(),
    user_id: v.optional(v.string()),
    organization_id: v.optional(v.string()),
    source: v.union(
      v.literal("subscription"),
      v.literal("extra_usage"),
      v.literal("team_extra_usage"),
      v.literal("manual_adjustment"),
    ),
    source_event_id: v.string(),
    idempotency_key: v.string(),
    gross_revenue_dollars: v.number(),
    net_revenue_dollars: v.number(),
    currency: v.string(),
    occurred_at: v.number(),
    attribution_strategy: v.union(
      v.literal("direct"),
      v.literal("split_evenly"),
      v.literal("organization_pool"),
    ),
    stripe_customer_id: v.optional(v.string()),
    stripe_subscription_id: v.optional(v.string()),
    stripe_invoice_id: v.optional(v.string()),
    stripe_checkout_session_id: v.optional(v.string()),
    stripe_payment_intent_id: v.optional(v.string()),
    stripe_price_id: v.optional(v.string()),
    plan: v.optional(v.string()),
    quantity: v.optional(v.number()),
    user_count: v.optional(v.number()),
    description: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_idempotency_key", ["idempotency_key"])
    .index("by_entity_occurred", ["entity_type", "entity_id", "occurred_at"])
    .index("by_user_occurred", ["user_id", "occurred_at"])
    .index("by_org_occurred", ["organization_id", "occurred_at"])
    .index("by_source_event", ["source", "source_event_id"]),

  // Compact daily rows intended for dashboarding and PostHog warehouse sync.
  // Query either entity_type=user for per-user profitability or
  // entity_type=organization for team pool/subscription reporting.
  unit_economics_daily: defineTable({
    entity_type: v.union(v.literal("user"), v.literal("organization")),
    entity_id: v.string(),
    user_id: v.optional(v.string()),
    organization_id: v.optional(v.string()),
    day: v.string(),
    gross_revenue_dollars: v.number(),
    net_revenue_dollars: v.number(),
    model_cost_dollars: v.number(),
    non_model_cost_dollars: v.number(),
    total_cost_dollars: v.number(),
    gross_profit_dollars: v.number(),
    included_usage_cost_dollars: v.number(),
    extra_usage_cost_dollars: v.number(),
    usage_request_count: v.number(),
    revenue_event_count: v.number(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    cache_read_tokens: v.number(),
    cache_write_tokens: v.number(),
    total_tokens: v.number(),
    updated_at: v.number(),
  })
    .index("by_entity_day", ["entity_type", "entity_id", "day"])
    .index("by_day", ["day"])
    .index("by_type_day", ["entity_type", "day"])
    .index("by_user_day", ["user_id", "day"])
    .index("by_org_day", ["organization_id", "day"]),

  // Webhook idempotency (prevents double-crediting on Stripe retries)
  processed_webhooks: defineTable({
    event_id: v.string(),
    processed_at: v.number(),
    // State-machine fields for atomic claim/finalize. Optional for
    // backwards compatibility — legacy rows (no status) are treated as
    // completed since they were inserted under the old "mark on entry"
    // semantics for events whose lifecycle has already concluded.
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"))),
    claimed_at: v.optional(v.number()),
  }).index("by_event_id", ["event_id"]),

  // Durable idempotency records for user-visible checkout session confirms.
  // Unlike webhook retry deduplication, these keys must not be time-purged
  // because a paid Checkout Session ID can be replayed by the purchaser.
  processed_checkout_sessions: defineTable({
    session_key: v.string(),
    processed_at: v.number(),
    // Optional purchase provenance. Older rows predate these fields and are
    // backfilled from the signed provider payload when their first refund is
    // processed.
    user_id: v.optional(v.string()),
    credited_points: v.optional(v.number()),
    // LemonSqueezy reports the cumulative refunded USD amount on every
    // order_refunded event. Persist the monotonic high-water mark and the
    // corresponding cumulative credit revocation so duplicate/out-of-order
    // deliveries can only revoke the incremental delta once.
    refunded_usd_cents: v.optional(v.number()),
    revoked_points: v.optional(v.number()),
    refund_updated_at: v.optional(v.number()),
  }).index("by_session_key", ["session_key"]),

  // Server-side rate limiting for verification-code (OTP) emails. Stops an
  // attacker who calls the sign-up/resend endpoint directly (bypassing the
  // client-side cooldown) from email-bombing arbitrary inboxes or burning the
  // Resend send quota / sender reputation. One row per canonicalized recipient,
  // holding a fixed counting window plus the last-send timestamp for the short
  // min-interval. See convex/otpRateLimit.ts.
  otp_send_limits: defineTable({
    // Canonicalized recipient email (see emailCanonical) so +tag / dot / case
    // variants of one inbox share a single bucket.
    email: v.string(),
    // Start of the current counting window (ms since epoch).
    window_start: v.number(),
    // Permitted sends within the current window.
    count: v.number(),
    // Timestamp of the last permitted send (ms), for the min-interval gate.
    last_sent_at: v.number(),
  })
    .index("by_email", ["email"])
    // For the cleanup cron: purge rows whose last send is well in the past.
    .index("by_last_sent", ["last_sent_at"]),

  // Global backstop counter for OTP emails. Per-IP limiting is not reachable
  // from the auth action context (the request has no real client IP there), so
  // a single rolling daily cap bounds total blast radius / Resend spend if the
  // per-email limiter is somehow evaded at scale. Single row, keyed by bucket.
  otp_global_limits: defineTable({
    bucket: v.string(),
    window_start: v.number(),
    count: v.number(),
  }).index("by_bucket", ["bucket"]),

  // User-configured MCP (Model Context Protocol) servers / connectors. Each row
  // is one remote MCP endpoint whose tools get connected at request time and
  // merged into the agent's tool set (see lib/ai/mcp/*). This is the foundation
  // the future "Plugins / Connectors" UI builds on.
  mcp_servers: defineTable({
    user_id: v.string(),
    // Stable provider/catalog identity when installed from the curated catalog.
    // Custom endpoints omit it and remain fully supported.
    catalog_id: v.optional(v.string()),
    // Display name; also used to namespace the server's tool names so two
    // servers exposing a tool of the same name don't collide.
    name: v.string(),
    // Remote endpoint URL (Streamable HTTP or legacy SSE).
    url: v.string(),
    // Transport hint. "http" = Streamable HTTP (modern, default); "sse" =
    // legacy Server-Sent-Events transport. The client also auto-falls-back
    // from http→sse at connect time, so this is just the preferred order.
    transport: v.union(v.literal("http"), v.literal("sse")),
    auth_kind: v.optional(
      v.union(
        v.literal("none"),
        v.literal("bearer"),
        v.literal("api_key_header"),
        v.literal("oauth"),
      ),
    ),
    // Legacy plaintext headers. New writes use `encrypted_credentials` below;
    // this field remains read-only compatibility data until existing rows are
    // successfully re-verified and migrated by the trusted backend.
    headers: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
    // AES-256-GCM envelope created/decrypted only in the Node server runtime.
    // Convex stores this as opaque authenticated ciphertext and never receives
    // the encryption key.
    encrypted_credentials: v.optional(encryptedMcpSecret),
    // OAuth access/refresh tokens and any DCR client secret are stored in a
    // separate purpose-bound envelope. They can never be replayed as headers.
    oauth_credentials: v.optional(encryptedMcpSecret),
    // Safe summaries only; token values never leave the trusted backend.
    oauth_expires_at: v.optional(v.number()),
    oauth_scopes: v.optional(v.array(v.string())),
    // Non-secret summary used by the client UI. Values are never exposed.
    credential_header_keys: v.optional(v.array(v.string())),
    // Runtime health is deliberately coarse: never persist provider errors,
    // response bodies, or credential-bearing diagnostics.
    connection_status: v.optional(
      v.union(v.literal("verified"), v.literal("needs_attention")),
    ),
    last_checked_at: v.optional(v.number()),
    // Monotonic compare-and-swap token for endpoint/auth configuration. This
    // stays optional while pre-existing rows are lazily backfilled; readers
    // expose a missing value as revision 1 and the next material write stores 2.
    config_revision: v.optional(v.number()),
    // Safe discovery snapshot. Names are already RIFT-namespaced; no tool
    // arguments, results, schemas, provider errors, or secrets are persisted.
    tool_count: v.optional(v.number()),
    tool_names: v.optional(v.array(v.string())),
    // When false the server is kept on file but its tools are not loaded.
    enabled: v.boolean(),
    created_at: v.number(),
    updated_at: v.number(),
  }).index("by_user", ["user_id"]),

  // Short-lived, one-time OAuth/PKCE state. Only a SHA-256 lookup key and an
  // opaque AES-GCM payload are stored. The callback consumes the row
  // transactionally before exchanging the authorization code.
  mcp_oauth_sessions: defineTable({
    user_id: v.string(),
    state_hash: v.string(),
    encrypted_state: encryptedMcpSecret,
    expires_at: v.number(),
    created_at: v.number(),
  })
    .index("by_state_hash", ["state_hash"])
    .index("by_user", ["user_id"])
    .index("by_expiry", ["expires_at"]),

  // User skills — loadable instruction packs (à la Claude SKILL.md). Each enabled
  // skill's instructions are injected into the agent as a <system-reminder> for
  // matching-scope chats (see lib/ai/skills/*). Curated skills are "installed"
  // by copying their instructions into a row; custom skills are authored inline.
  skills: defineTable({
    user_id: v.string(),
    name: v.string(),
    description: v.string(),
    // The instruction text injected into the agent when this skill is enabled.
    instructions: v.string(),
    // Which chat purpose this skill applies to. "all" = every mode.
    scope: v.union(
      v.literal("all"),
      v.literal("security"),
      v.literal("app"),
      v.literal("image"),
    ),
    // Set when installed from the curated catalog (lib/ai/skills/skill-catalog).
    // Undefined for user-authored custom skills.
    catalog_id: v.optional(v.string()),
    enabled: v.boolean(),
    created_at: v.number(),
    updated_at: v.number(),
  }).index("by_user", ["user_id"]),

  // User projects — named workspaces of a chosen type (Security / Build / Image).
  // Shown in the sidebar; opening one starts work in that mode. Chats may be
  // associated at creation through the optional, server-validated project_id.
  projects: defineTable({
    github_repository: v.optional(githubRepositoryValidator),
    user_id: v.string(),
    name: v.string(),
    type: v.union(v.literal("security"), v.literal("app"), v.literal("image")),
    // Optional exact roster mention selected when the project is created.
    // The runtime resolves it against the owner's enabled agent/team roster.
    agent_mention: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
    // Soft deletion keeps historical chat bindings referentially meaningful.
    archived_at: v.optional(v.number()),
  })
    .index("by_user", ["user_id"])
    .index("by_user_and_archived", ["user_id", "archived_at"]),

  project_bots: defineTable({
    user_id: v.string(),
    project_id: v.id("projects"),
    chat_id: v.string(),
    template_id: v.string(),
    template_version: v.number(),
    name: v.string(),
    mission: v.string(),
    profile_json: v.string(),
    request_id: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
    archived_at: v.optional(v.number()),
  })
    .index("by_user_project", ["user_id", "project_id"])
    .index("by_user_request", ["user_id", "request_id"])
    .index("by_chat", ["chat_id"]),

  bot_meetings: defineTable({
    user_id: v.string(),
    project_id: v.id("projects"),
    chat_id: v.string(),
    participant_bot_ids: v.array(v.id("project_bots")),
    title: v.string(),
    agenda: v.string(),
    request_id: v.string(),
    task_id: v.optional(v.id("tasks")),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_project", ["user_id", "project_id"])
    .index("by_user_request", ["user_id", "request_id"]),

  // Durable user tasks. The declarative Trigger.dev dispatcher claims due
  // rows through next_run_at; schedule_version invalidates queued work when a
  // user edits, disables, completes, or re-enables a task.
  tasks: defineTable({
    user_id: v.string(),
    project_id: v.optional(v.id("projects")),
    assignee_bot_id: v.optional(v.id("project_bots")),
    bot_meeting_id: v.optional(v.id("bot_meetings")),
    title: v.string(),
    prompt: v.string(),
    purpose: v.optional(v.union(v.literal("security"), v.literal("app"))),
    status: v.union(v.literal("open"), v.literal("completed")),
    enabled: v.boolean(),
    schedule_type: v.union(
      v.literal("manual"),
      v.literal("once"),
      v.literal("recurring"),
    ),
    scheduled_for: v.optional(v.number()),
    schedule_expression: v.optional(v.string()),
    timezone: v.optional(v.string()),
    scheduler_state: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("inactive"),
        v.literal("invalid"),
      ),
    ),
    schedule_error: v.optional(v.string()),
    next_run_at: v.optional(v.number()),
    schedule_version: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
    completed_at: v.optional(v.number()),
  })
    .index("by_user_and_updated", ["user_id", "updated_at"])
    .index("by_assignee_bot", ["assignee_bot_id"])
    .index("by_user_status_and_updated", ["user_id", "status", "updated_at"])
    .index("by_user_schedule_and_updated", [
      "user_id",
      "schedule_type",
      "updated_at",
    ])
    .index("by_scheduler_state_and_next_run", [
      "scheduler_state",
      "next_run_at",
    ]),

  // Execution history written by a trusted backend runner. The Tasks UI is
  // read-only for this table, so creating a task can never fabricate a run.
  task_runs: defineTable({
    task_id: v.id("tasks"),
    user_id: v.string(),
    run_id: v.string(),
    execution_key: v.optional(v.string()),
    schedule_version: v.optional(v.number()),
    scheduled_at: v.optional(v.number()),
    dispatch_lease_owner: v.optional(v.string()),
    dispatch_lease_until: v.optional(v.number()),
    dispatch_attempts: v.optional(v.number()),
    worker_run_id: v.optional(v.string()),
    agent_run_id: v.optional(v.string()),
    run_lease_until: v.optional(v.number()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    chat_id: v.optional(v.string()),
    started_at: v.number(),
    finished_at: v.optional(v.number()),
    error_message: v.optional(v.string()),
  })
    .index("by_run_id", ["run_id"])
    .index("by_execution_key", ["execution_key"])
    .index("by_user_and_started", ["user_id", "started_at"])
    .index("by_user_and_status", ["user_id", "status"])
    .index("by_status_and_dispatch_lease", ["status", "dispatch_lease_until"])
    .index("by_status_and_run_lease", ["status", "run_lease_until"])
    .index("by_user_task_and_started", ["user_id", "task_id", "started_at"]),

  // Connected GitHub account (personal access token) per user. The token lets
  // the agent (Build) and the user's terminal (CLI) clone/push repos. Stored so
  // it can be injected into the sandbox's git credentials.
  // SECURITY: plaintext token for now — treat as a secret; move to an encrypted
  // store before GA. Never return the token to the client (see convex/github.ts).
  github_oauth_handoffs: defineTable({
    user_id: v.string(),
    ticket_hash: v.string(),
    ciphertext: v.string(),
    expires_at: v.number(),
  }).index("by_ticket", ["ticket_hash"]),
  github_connections: defineTable({
    user_id: v.string(),
    token: v.string(),
    refresh_token: v.optional(v.string()),
    expires_at: v.optional(v.number()),
    refresh_expires_at: v.optional(v.number()),
    credentials_version: v.optional(v.number()),
    refresh_lease_id: v.optional(v.string()),
    refresh_lease_until: v.optional(v.number()),
    username: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  }).index("by_user", ["user_id"]),

  // Paid-plan personal API keys let Pro and Max users drive Build/Studio from
  // terminal scripts through /api/chat. Hack Workbench separately revalidates
  // that the live key tier is Max before /api/hack-chat can execute.
  // Only the SHA-256 hash is stored; the plaintext key is shown once at
  // creation and never persisted or returned again (see convex/apiKeys.ts).
  api_keys: defineTable({
    user_id: v.string(),
    name: v.string(),
    key_hash: v.string(),
    // First ~14 chars of the plaintext key (e.g. "rift_live_ab12"), shown in
    // the UI so the user can tell keys apart without re-revealing the secret.
    key_prefix: v.string(),
    created_at: v.number(),
    last_used_at: v.optional(v.number()),
    revoked_at: v.optional(v.number()),
  })
    .index("by_user", ["user_id"])
    .index("by_key_hash", ["key_hash"]),

  // Apps published from a Build run. The sandbox that produced the app is
  // disposable — its preview URL dies with it — so publishing deploys the built
  // output to Vercel and this row records where it went, so the workspace can
  // show the address again without asking Vercel every time.
  published_sites: defineTable({
    user_id: v.string(),
    chat_id: v.string(),
    // Display name shown in the UI; the product's own name where it has one.
    title: v.string(),
    // Vercel project the app deploys to. Suffixed per user, because one team
    // holds every published project and two users may both call their app the
    // same thing.
    project_name: v.string(),
    deployment_id: v.string(),
    // Stable alias to show and share (`<project>.vercel.app`), not the
    // per-deployment hostname that changes on every publish.
    url: v.string(),
    file_count: v.number(),
    total_bytes: v.number(),
    published_at: v.number(),
  })
    .index("by_project", ["project_name"])
    .index("by_user", ["user_id"])
    .index("by_chat", ["chat_id"]),
  // Immutable admission identity for hosted terminal requests. A disconnected
  // reader may observe the same work, but can never re-submit a paid producer.
  console_workspace_operations: defineTable({
    operation_id: v.string(),
    chat_id: v.string(),
    user_id: v.string(),
    workspace: v.union(v.literal("studio"), v.literal("hack")),
    request_hash: v.string(),
    status: v.string(),
    permission: v.union(v.literal("ask"), v.literal("auto")),
    target: v.optional(v.string()),
    task_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_operation", ["operation_id"])
    .index("by_chat", ["chat_id"]),
});
