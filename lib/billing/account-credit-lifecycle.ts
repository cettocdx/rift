import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import {
  calculateRawModelCostDollars,
  computeActualCostPoints,
} from "@/lib/rate-limit/token-bucket";
import { assertCreditInteger } from "@/convex/lib/accountCreditSettlement";

// Per transport attempt, fixed by the server. Reserve/close retain their one
// same-key recovery attempt; first use and settlement never retry implicitly.
const CREDIT_REQUEST_DEADLINE_MS = 10_000;

type ReserveResult = FunctionReturnType<
  typeof api.extraUsage.reserveAccountCredits
>;
type FirstUseResult =
  | FunctionReturnType<typeof api.extraUsage.startAccountCreditReservationUse>
  | FunctionReturnType<typeof api.extraUsage.admitProductionAccountCreditUse>;
type Receipt = Extract<ReserveResult, { receipt: unknown }>["receipt"];
type SettlementResult = FunctionReturnType<
  typeof api.extraUsage.settleAccountCreditReservation
>;
type Client = ReturnType<typeof getConvexClient>;
type Binding = Readonly<{
  reservationKey: string;
  userId: string;
  subscription: "pro" | "ultra";
  amountPoints: number;
}>;
type Setup = {
  userId: string;
  subscription: "pro" | "ultra";
  amountPoints: number;
  allowAutoReload: false;
  pricingMargin?: number;
};
type ProductionConsoleBinding = Readonly<{
  version: 1;
  kind: "console_model";
  requestId: string;
}>;
type Phase =
  | "ready"
  | "reserving"
  | "reserve_unknown"
  | "reserved"
  | "denied"
  | "starting"
  | "use_unknown"
  | "in_use"
  | "closing"
  | "close_unknown"
  | "closed"
  | "settling"
  | "settlement_unknown"
  | "settled"
  | "reconciliation_required";

/** Caller must positively know that these are its own terminal observations.
 * Absence of reported usage after dispatch is unknown, never inferred zero. */
export type ServerTerminalObservation =
  | {
      status: "known";
      modelName: string;
      inputTokens: number;
      outputTokens: number;
      modelProviderCostDollars?: number;
      nonModelCostDollars: number;
    }
  | {
      status: "unknown";
      reason: "interrupted" | "provider_unavailable" | "missing_usage";
    };

type TerminalInput = {
  revision: 1;
  pricingVersion: "account-credit-v1";
  actualPoints: number | null;
  usage:
    | {
        status: "known";
        source: "provider" | "server_estimate";
        model: string;
        inputTokens: number;
        outputTokens: number;
        modelCostDollars: number;
        nonModelCostDollars: number;
      }
    | {
        status: "unknown";
        reason: "interrupted" | "provider_unavailable" | "missing_usage";
      };
  usageDigest: string;
};

export class CreditLifecycleError extends Error {
  constructor(
    readonly code: string,
    readonly receipt?: Readonly<Receipt>,
  ) {
    super(`Credit lifecycle: ${code}`);
    this.name = "CreditLifecycleError";
  }
}

// Not exported or JSON-reconstructible. A snapshot belongs to one adapter,
// including when another adapter happens to address the same durable key.
class TerminalSnapshot {
  readonly #owner: object;
  readonly #input: Readonly<TerminalInput>;
  constructor(owner: object, input: TerminalInput) {
    this.#owner = owner;
    this.#input = Object.freeze({
      ...input,
      usage: Object.freeze({ ...input.usage }),
    });
    Object.freeze(this);
  }
  read(owner: object) {
    if (owner !== this.#owner)
      throw new CreditLifecycleError("foreign terminal snapshot");
    return this.#input;
  }
}

/** Inactive per-attempt billing client. Factories must run after real server
 * authentication; supplied worker IDs must come from Trigger/claim state.
 * This is not an entitlement, claim, cancellation or debt admission service.
 * No caller accepts an end-user reservation key. No existing caller uses it yet. */
export class AccountCreditLifecycle {
  readonly operationId: string;
  readonly #pricingMargin?: number;
  readonly #binding: Binding;
  readonly #productionBinding?: ProductionConsoleBinding;
  readonly #client: Client;
  readonly #serviceKey: string;
  readonly #snapshotOwner = {};
  #phase: Phase = "ready";
  #reservationAttempted = false;
  #useAttempted = false;
  #useGranted = false;
  #closeRequested = false;
  #receipt?: Readonly<Receipt>;
  #reserveFlight?: Promise<Readonly<Receipt>>;
  #closeFlight?: Promise<{ state: "closed" | "unresolved" }>;
  #snapshot?: TerminalSnapshot;
  #settleFlight?: Promise<SettlementResult>;
  #settlementAck?: SettlementResult;

  private constructor(
    setup: Setup,
    kind: "agent" | "chat" | "console",
    id: string,
    productionConsole = false,
  ) {
    assertCreditInteger(setup.amountPoints);
    if (
      !setup.userId.trim() ||
      !["pro", "ultra"].includes(setup.subscription) ||
      setup.allowAutoReload !== false ||
      "reservationKey" in setup
    )
      throw new CreditLifecycleError("ineligible binding");
    const key = `credit:${kind}:${id}:preflight`;
    if (key.length > 200)
      throw new CreditLifecycleError("invalid operation identity");
    const serviceKey = getConvexServiceKey();
    if (!serviceKey?.trim())
      throw new CreditLifecycleError("service authority unavailable");
    this.operationId = id;
    this.#pricingMargin = setup.pricingMargin;
    if (productionConsole)
      this.#productionBinding = Object.freeze({
        version: 1,
        kind: "console_model",
        requestId: id,
      });
    this.#binding = Object.freeze({
      reservationKey: key,
      userId: setup.userId,
      subscription: setup.subscription,
      amountPoints: setup.amountPoints,
    });
    // Pin both before any await: a later global URL override cannot switch a
    // pending operation onto another deployment during recovery/settlement.
    this.#client = getConvexClient();
    this.#serviceKey = serviceKey;
    Object.freeze(this);
  }
  static forAgentRun(
    setup: Setup & { runId: string; chatId: string; claimId: string },
  ) {
    for (const value of [setup.runId, setup.chatId, setup.claimId])
      if (!value?.trim())
        throw new CreditLifecycleError("invalid worker identity");
    return new AccountCreditLifecycle(setup, "agent", setup.runId);
  }
  static forChat(setup: Setup) {
    return new AccountCreditLifecycle(setup, "chat", randomUUID());
  }
  static forConsole(setup: Setup) {
    return new AccountCreditLifecycle(setup, "console", randomUUID());
  }

  /** Server-authenticated console requests only; immutable admission binding
   * selects production endpoints with no weak fallback. */
  static forProductionConsole(setup: Setup) {
    if (["binding", "requestId", "operationId"].some((key) => key in setup))
      throw new CreditLifecycleError("ineligible binding");
    return new AccountCreditLifecycle(setup, "console", randomUUID(), true);
  }

  inspect() {
    return Object.freeze({
      userId: this.#binding.userId,
      subscription: this.#binding.subscription,
      phase: this.#phase,
      operationId: this.operationId,
      reservationKey: this.#binding.reservationKey,
      reservationAttempted: this.#reservationAttempted,
      dispatchGranted: this.#useGranted,
    });
  }
  #args() {
    return { ...this.#binding, serviceKey: this.#serviceKey };
  }
  async #request<T>(invoke: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new CreditLifecycleError("request deadline exceeded")),
        CREDIT_REQUEST_DEADLINE_MS,
      );
      timer.unref?.();
    });
    try {
      // Race only the transport result, never a state-mutating continuation.
      // Promise.race observes late rejections; a late success cannot update the
      // phase or turn a timed-out admission into a provider dispatch grant.
      return await Promise.race([invoke(), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #bounded<T>(
    invoke: () => Promise<T>,
    cancelled?: () => boolean,
  ): Promise<T> {
    try {
      return await this.#request(invoke);
    } catch {
      if (cancelled?.()) throw new CreditLifecycleError("close requested");
      // Exactly one recovery attempt, only for an idempotent keyed operation.
      return this.#request(invoke);
    }
  }

  async reserve(): Promise<Readonly<Receipt>> {
    if (this.#closeRequested) throw new CreditLifecycleError("close requested");
    if (this.#reserveFlight) return this.#reserveFlight;
    if (this.#phase === "reserved" && this.#receipt) return this.#receipt;
    if (!["ready", "reserve_unknown"].includes(this.#phase))
      throw new CreditLifecycleError("reservation unavailable");
    // Set synchronously before even scheduling the transport call.
    this.#reservationAttempted = true;
    this.#phase = "reserving";
    this.#reserveFlight = Promise.resolve()
      .then(async () => {
        let result: ReserveResult;
        try {
          result = await this.#bounded(
            () =>
              this.#productionBinding
                ? this.#client.mutation(
                    api.extraUsage.reserveProductionAccountCredits,
                    {
                      ...this.#args(),
                      binding: this.#productionBinding,
                    },
                  )
                : this.#client.mutation(
                    api.extraUsage.reserveAccountCredits,
                    this.#args(),
                  ),
            () => this.#closeRequested,
          );
        } catch {
          if (!this.#closeRequested) this.#phase = "reserve_unknown";
          throw new CreditLifecycleError("reservation response unresolved");
        }
        if (this.#closeRequested)
          throw new CreditLifecycleError("close requested");
        if (result?.state === "reserved" && result.receipt?.success === true) {
          const r = result.receipt;
          if (
            !Number.isSafeInteger(r.includedPointsDeducted) ||
            r.includedPointsDeducted < 0 ||
            !Number.isSafeInteger(r.purchasedPointsDeducted) ||
            r.purchasedPointsDeducted < 0 ||
            r.includedPointsDeducted + r.purchasedPointsDeducted !==
              this.#binding.amountPoints
          ) {
            this.#phase = "reserve_unknown";
            throw new CreditLifecycleError("invalid reservation response");
          }
          this.#phase = "reserved";
          this.#receipt = Object.freeze({ ...r });
          return this.#receipt;
        }
        if (
          result?.state === "denied" &&
          result.receipt?.success === false &&
          result.receipt.includedPointsDeducted === 0 &&
          result.receipt.purchasedPointsDeducted === 0
        ) {
          this.#phase = "denied";
          throw new CreditLifecycleError(
            "denied",
            Object.freeze({ ...result.receipt }),
          );
        }
        this.#phase =
          result?.state === "closed"
            ? "closed"
            : result?.state === "settled"
              ? "settled"
              : ["in_use", "reconciliation_required"].includes(result?.state)
                ? "reconciliation_required"
                : "reserve_unknown";
        throw new CreditLifecycleError("reservation unavailable");
      })
      .finally(() => {
        this.#reserveFlight = undefined;
      });
    return this.#reserveFlight;
  }

  async closeBeforeUse(): Promise<{ state: "closed" | "unresolved" }> {
    this.#closeRequested = true;
    // A positively acknowledged closed tombstone proves restoration or no
    // debit, even if it arrived as the result of a first-use race.
    if (this.#phase === "closed") return { state: "closed" };
    if (this.#useAttempted) {
      // A first-use response can be lost or arrive after cancellation. Never
      // infer no work or refund from absent observations after this boundary.
      return { state: "unresolved" };
    }
    if (this.#closeFlight) return this.#closeFlight;
    this.#phase = "closing";
    this.#closeFlight = Promise.resolve()
      .then(async () => {
        try {
          const result = await this.#bounded(() =>
            this.#client.mutation(
              api.extraUsage.closeAccountCreditReservation,
              this.#args(),
            ),
          );
          if (result?.state !== "closed" && result?.state !== "unresolved")
            throw new CreditLifecycleError("invalid close response");
          this.#phase =
            result.state === "closed" ? "closed" : "reconciliation_required";
          return result;
        } catch {
          this.#phase = "close_unknown";
          throw new CreditLifecycleError("close response unresolved");
        }
      })
      .finally(() => {
        this.#closeFlight = undefined;
      });
    return this.#closeFlight;
  }

  async startUse(): Promise<{ newlyGranted: true }> {
    if (
      this.#closeRequested ||
      this.#useAttempted ||
      this.#phase !== "reserved"
    )
      throw new CreditLifecycleError("dispatch not granted");
    // Do not single-flight/share a true grant among multiple callers. Only the
    // first local invocation may receive permission, and this call never retries.
    this.#useAttempted = true;
    this.#phase = "starting";
    let result;
    try {
      result = await this.#request<FirstUseResult>(() =>
        this.#productionBinding
          ? this.#client.mutation(
              api.extraUsage.admitProductionAccountCreditUse,
              {
                ...this.#args(),
                binding: this.#productionBinding,
              },
            )
          : this.#client.mutation(
              api.extraUsage.startAccountCreditReservationUse,
              this.#args(),
            ),
      );
    } catch {
      this.#phase = "use_unknown";
      throw new CreditLifecycleError("first use response unresolved");
    }
    if (result?.state === "closed" && result.newlyGranted === false) {
      this.#phase = "closed";
      throw new CreditLifecycleError("dispatch not granted");
    }
    if (this.#closeRequested) {
      this.#phase = "use_unknown";
      throw new CreditLifecycleError("dispatch canceled during admission");
    }
    if (result?.state !== "in_use" || result.newlyGranted !== true) {
      this.#phase = "reconciliation_required";
      throw new CreditLifecycleError("dispatch not granted");
    }
    this.#useGranted = true;
    this.#phase = "in_use";
    return { newlyGranted: true };
  }

  captureTerminalUsage(
    observation: ServerTerminalObservation,
  ): TerminalSnapshot {
    if (!this.#useGranted)
      throw new CreditLifecycleError(
        "terminal usage requires acknowledged first use",
      );
    let usage: TerminalInput["usage"];
    let actualPoints: number | null;
    if (observation.status === "unknown") {
      if (
        !["interrupted", "provider_unavailable", "missing_usage"].includes(
          observation.reason,
        )
      )
        throw new CreditLifecycleError("invalid unknown usage");
      usage = { status: "unknown", reason: observation.reason };
      actualPoints = null;
    } else {
      assertCreditInteger(observation.inputTokens);
      assertCreditInteger(observation.outputTokens);
      const hasProviderCost =
        observation.modelProviderCostDollars !== undefined;
      const provider = observation.modelProviderCostDollars ?? 0;
      const nonModel = observation.nonModelCostDollars;
      if (
        observation.status !== "known" ||
        !observation.modelName?.trim() ||
        observation.modelName.length > 256 ||
        !Number.isFinite(provider) ||
        provider < 0 ||
        !Number.isFinite(nonModel) ||
        nonModel < 0
      )
        throw new CreditLifecycleError("invalid terminal usage");
      actualPoints = computeActualCostPoints({
        actualInputTokens: observation.inputTokens,
        actualOutputTokens: observation.outputTokens,
        modelName: observation.modelName,
        providerCostDollars: hasProviderCost ? provider + nonModel : undefined,
        nonModelCostDollars: nonModel,
        pricingMargin: this.#pricingMargin,
      });
      assertCreditInteger(actualPoints);
      usage = {
        status: "known",
        source: hasProviderCost ? "provider" : "server_estimate",
        model: observation.modelName,
        inputTokens: observation.inputTokens,
        outputTokens: observation.outputTokens,
        modelCostDollars: hasProviderCost
          ? provider
          : calculateRawModelCostDollars(
              observation.inputTokens,
              observation.outputTokens,
              observation.modelName,
            ),
        nonModelCostDollars: nonModel,
      };
    }
    const input = {
      revision: 1 as const,
      pricingVersion: "account-credit-v1" as const,
      actualPoints,
      usage,
    };
    const canonical = JSON.stringify({
      reservationKey: this.#binding.reservationKey,
      userId: this.#binding.userId,
      amountPoints: this.#binding.amountPoints,
      subscription: this.#binding.subscription,
      ...input,
    });
    const usageDigest = createHash("sha256").update(canonical).digest("hex");
    const next = { ...input, usageDigest };
    if (this.#snapshot) {
      if (this.#snapshot.read(this.#snapshotOwner).usageDigest !== usageDigest)
        throw new CreditLifecycleError("terminal usage is immutable");
      return this.#snapshot;
    }
    this.#snapshot = new TerminalSnapshot(this.#snapshotOwner, next);
    return this.#snapshot;
  }

  async settle(snapshot: TerminalSnapshot): Promise<SettlementResult> {
    if (
      !(snapshot instanceof TerminalSnapshot) ||
      snapshot !== this.#snapshot ||
      !this.#useGranted
    )
      throw new CreditLifecycleError("invalid terminal snapshot");
    const input = snapshot.read(this.#snapshotOwner);
    if (this.#settlementAck) return this.#settlementAck;
    if (this.#settleFlight) return this.#settleFlight;
    this.#phase = "settling";
    this.#settleFlight = Promise.resolve()
      .then(async () => {
        try {
          const result = await this.#request(() =>
            this.#client.mutation(
              api.extraUsage.settleAccountCreditReservation,
              { ...this.#args(), ...input },
            ),
          );
          if (result?.state === "settled") {
            const r = result.receipt;
            if (
              input.actualPoints === null ||
              r?.revision !== 1 ||
              r.actualPoints !== input.actualPoints ||
              r.adjustmentPoints !==
                input.actualPoints - this.#binding.amountPoints ||
              !Number.isSafeInteger(r.includedPoints) ||
              r.includedPoints < 0 ||
              !Number.isSafeInteger(r.purchasedPoints) ||
              r.purchasedPoints < 0 ||
              !Number.isSafeInteger(r.debtPointsAdded) ||
              r.debtPointsAdded < 0 ||
              r.includedPoints + r.purchasedPoints + r.debtPointsAdded !==
                input.actualPoints
            )
              throw new CreditLifecycleError("invalid settlement response");
            this.#settlementAck = Object.freeze({
              ...result,
              receipt: Object.freeze({ ...r }),
            });
          } else if (
            result?.state === "reconciliation_required" &&
            ["unknown_usage", "source_changed"].includes(result.reason)
          ) {
            this.#settlementAck = Object.freeze({ ...result });
          } else throw new CreditLifecycleError("invalid settlement response");
          this.#phase = result.state;
          return this.#settlementAck;
        } catch {
          this.#phase = "settlement_unknown";
          throw new CreditLifecycleError("settlement response unresolved");
        }
      })
      .finally(() => {
        this.#settleFlight = undefined;
      });
    return this.#settleFlight;
  }
}
