/** Local transport acceptance only, not execution completion or proof of no dispatch on error. */
export type DispatchReceiptObserver = Readonly<{
  accepted: () => void;
  failed: (error: unknown) => void;
}>;

type ReceiptMetadata = {
  metadata: unknown;
  receipt: DispatchReceiptObserver;
};
const receipts = new WeakMap<object, ReceiptMetadata>();

/** Pass as request options.metadata, never message.metadata or request body.
 * The private envelope is recognized only by identity and is stripped before
 * request preparation. Existing ordinary request metadata can be forwarded. */
export function createDispatchReceiptMetadata(
  observer: DispatchReceiptObserver,
  forwardedMetadata?: unknown,
): unknown {
  const envelope = Object.freeze(Object.create(null)) as object;
  let pending: DispatchReceiptObserver | undefined = observer;
  const settle = (outcome: "accepted" | "failed", error?: unknown) => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    try {
      if (outcome === "accepted") current.accepted();
      else current.failed(error);
    } catch {
      // An observer cannot turn an accepted transport into a failed dispatch,
      // or replace the original transport error. Its owner controls UI state.
    }
  };
  receipts.set(envelope, {
    metadata: forwardedMetadata,
    receipt: {
      accepted: () => settle("accepted"),
      failed: (error) => settle("failed", error),
    },
  });
  return envelope;
}

/** Transport-only unwrapping. Repeated SDK calls share one receipt settlement. */
export function consumeDispatchReceiptMetadata(metadata: unknown): {
  metadata: unknown;
  receipt?: DispatchReceiptObserver;
} {
  if (metadata && typeof metadata === "object") {
    const value = receipts.get(metadata);
    if (value) return value;
  }
  return { metadata };
}
