/** The delivery mirror must finish even when the remote event store is unavailable.
 * Its consumer drives model completion and durable message persistence. Never
 * replay model/tools to repair a failed event upload. Source errors still fail.
 */
export async function settleAgentUiStream(
  upload: Promise<unknown>,
  consume: Promise<void>,
): Promise<{ deliveryInterrupted: boolean }> {
  const [delivery, source] = await Promise.allSettled([upload, consume]);
  if (source.status === "rejected") throw source.reason;
  if (delivery.status === "fulfilled") return { deliveryInterrupted: false };
  const error = delivery.reason;
  // Narrow to the observed S2 transport timeout. Invalid records and arbitrary
  // application errors must not be hidden as successful delivery.
  if (
    error instanceof Error &&
    error.name === "S2Error" &&
    /Max attempts \(\d+\) exhausted: Request timeout after \d+ms/.test(
      error.message,
    )
  )
    return { deliveryInterrupted: true };
  throw error;
}
