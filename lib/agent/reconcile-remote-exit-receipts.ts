export type RecoveryOwner = {
  userId: string;
  chatId: string;
  claimId: string;
  runId: string;
};
export type PendingResource = RecoveryOwner & {
  resourceId: string;
  sandboxId: string;
  pid?: number;
  processIdentity?: string;
};
export type ExitReceipt = {
  resourceId: string;
  pid: number;
  processIdentity: string;
  state: string;
  descendantsReaped: boolean;
};
type Dependencies = {
  producer(): Promise<{
    id: string;
    status: string;
    taskIdentifier: string;
    userId: string;
    chatId: string;
    claimId: string;
    cleanupDrained?: boolean;
  }>;
  page(
    state: "reserved" | "started",
    cursor: string | null,
  ): Promise<{
    page: PendingResource[];
    isDone: boolean;
    continueCursor: string;
  }>;
  read(resource: PendingResource): Promise<unknown>;
  started(resource: PendingResource, receipt: ExitReceipt): Promise<boolean>;
  exited(resource: PendingResource, receipt: ExitReceipt): Promise<boolean>;
  absent?(resource: PendingResource): Promise<boolean>;
  complete?(owner: RecoveryOwner): Promise<boolean>;
};
const TERMINAL = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
]);
/** Receipt reconciliation only: never kills a process, starts a command, resumes
 * a task or infers exit from worker status/transport failure. A claim may be
 * released only with separate worker drain proof and all exit receipts saved. */
export async function reconcileRemoteExitReceipts(
  owner: RecoveryOwner,
  deps: Dependencies,
  signal?: AbortSignal,
) {
  const result = {
    reconciled: 0,
    unconfirmed: 0,
    interrupted: false,
    producerActive: false,
    released: false,
  };
  const producer = await deps.producer();
  if (
    producer.id !== owner.runId ||
    producer.userId !== owner.userId ||
    producer.chatId !== owner.chatId ||
    producer.claimId !== owner.claimId ||
    !["agent-long", "hack-long"].includes(producer.taskIdentifier)
  )
    throw new Error("Recovery producer ownership mismatch");
  if (!TERMINAL.has(producer.status))
    return { ...result, producerActive: true };
  for (const state of ["reserved", "started"] as const) {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    while (true) {
      if (signal?.aborted) return { ...result, interrupted: true };
      const page = await deps.page(state, cursor);
      for (const resource of page.page) {
        if (signal?.aborted) return { ...result, interrupted: true };
        if (
          resource.userId !== owner.userId ||
          resource.chatId !== owner.chatId ||
          resource.claimId !== owner.claimId ||
          resource.runId !== owner.runId
        )
          throw new Error("Recovery resource ownership mismatch");
        try {
          const receipt = (await deps.read(resource)) as ExitReceipt;
          if (
            !receipt ||
            receipt.resourceId !== resource.resourceId ||
            !Number.isSafeInteger(receipt.pid) ||
            receipt.pid <= 0 ||
            typeof receipt.processIdentity !== "string" ||
            !receipt.processIdentity.startsWith("supervised-v1:") ||
            !receipt.processIdentity.endsWith(`:${resource.resourceId}`) ||
            (resource.pid !== undefined && receipt.pid !== resource.pid) ||
            (resource.processIdentity !== undefined &&
              receipt.processIdentity !== resource.processIdentity) ||
            receipt.state !== "exited" ||
            receipt.descendantsReaped !== true
          ) {
            result.unconfirmed++;
            continue;
          }
          if (signal?.aborted) return { ...result, interrupted: true };
          if (!(await deps.started(resource, receipt)))
            throw new Error("Start evidence not persisted");
          if (signal?.aborted) return { ...result, interrupted: true };
          if (!(await deps.exited(resource, receipt)))
            throw new Error("Exit evidence not persisted");
          result.reconciled++;
        } catch {
          // Only a completed drain plus independent control-plane evidence can
          // settle a vanished VM. Never translate this into command success.
          if (
            producer.taskIdentifier === "agent-long" &&
            producer.cleanupDrained === true &&
            deps.absent &&
            !signal?.aborted
          ) {
            try {
              if (await deps.absent(resource)) {
                result.reconciled++;
                continue;
              }
            } catch {
              /* Leave the resource pending on any verification failure. */
            }
          }
          result.unconfirmed++;
        }
      }
      if (page.isDone) break;
      if (!page.continueCursor || cursors.has(page.continueCursor))
        throw new Error("Recovery inventory pagination did not advance");
      cursors.add(page.continueCursor);
      cursor = page.continueCursor;
    }
  }
  if (signal?.aborted) return { ...result, interrupted: true };
  if (
    producer.taskIdentifier === "agent-long" &&
    producer.cleanupDrained === true &&
    result.unconfirmed === 0 &&
    deps.complete
  ) {
    result.released = await deps.complete(owner);
  }
  return result;
}
