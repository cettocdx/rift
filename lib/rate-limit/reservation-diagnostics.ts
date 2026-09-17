/** Bounded, request-local diagnostics. No account, amount, or payment fields. */
export type BillingReservationEvent =
  | {
      type: "strategy";
      strategy: "account_credits";
      autoReloadAllowed: boolean;
    }
  | {
      type: "strategy";
      strategy:
        | "free_agent_then_balance"
        | "free_ask_then_balance"
        | "legacy_token_bucket";
    }
  | {
      type: "stage";
      stage: "billingMigration" | "billingAccountDebit";
      durationMs: number;
    };

export type BillingReservationDiagnostics = (
  event: BillingReservationEvent,
) => void;

/** Instrumentation must never veto a debit or mask its original outcome. */
export function reportBillingReservation(
  observer: BillingReservationDiagnostics | undefined,
  event: BillingReservationEvent,
): void {
  try {
    if (observer) void Promise.resolve(observer(event)).catch(() => {});
  } catch {
    // Best effort, including sinks that synchronously throw.
  }
}

export async function measureBillingReservation<T>(
  observer: BillingReservationDiagnostics | undefined,
  stage: Extract<BillingReservationEvent, { type: "stage" }>["stage"],
  operation: () => Promise<T>,
): Promise<T> {
  if (!observer) return operation();
  const started = Date.now();
  try {
    return await operation();
  } finally {
    reportBillingReservation(observer, {
      type: "stage",
      stage,
      durationMs: Math.max(0, Date.now() - started),
    });
  }
}
