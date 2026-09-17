import {
  REMOTE_COMMAND_SUPERVISOR,
  REMOTE_COMMAND_STOP,
} from "./remote-command-supervisor";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

type Owner = { userId: string; chatId: string; claimId: string; runId: string };
const scope = new AsyncLocalStorage<{ owner?: Owner }>();
export function withRemoteCommandJournal<T>(callback: () => T): T {
  return scope.run({}, callback);
}
export function bindRemoteCommandJournal(owner: Owner): void {
  const current = scope.getStore();
  if (!current) throw new Error("Remote command journal scope is missing");
  if (current.owner) throw new Error("Remote command journal is already bound");
  current.owner = { ...owner };
}

type Sandbox = {
  sandboxId: string;
  commands: {
    run(
      command: string,
      options: { user: string; timeoutMs: number },
    ): Promise<unknown>;
  };
  files: {
    read(
      path: string,
      options: { user: string; requestTimeoutMs: number },
    ): Promise<string>;
  };
};
type Binding = Owner & { resourceId: string; sandboxId: string };
type Receipt = Binding & { pid: number; processIdentity: string };
export type JournalStore = {
  reserve(args: Binding): Promise<boolean>;
  started(args: Receipt): Promise<boolean>;
  exited(args: Receipt): Promise<boolean>;
  notStarted(args: Binding): Promise<boolean>;
};
async function backendStore(): Promise<JournalStore> {
  const [{ api }, { getConvexClient, getConvexServiceKey }] = await Promise.all(
    [import("@/convex/_generated/api"), import("@/lib/db/convex-client")],
  );
  const client = getConvexClient();
  const serviceKey = getConvexServiceKey()!;
  return {
    reserve: (args) =>
      client.mutation(api.agentRunResources.reserveCommand, {
        ...args,
        serviceKey,
      }),
    started: (args) =>
      client.mutation(api.agentRunResources.recordStarted, {
        ...args,
        serviceKey,
      }),
    exited: (args) =>
      client.mutation(api.agentRunResources.recordExited, {
        ...args,
        serviceKey,
      }),
    notStarted: (args) =>
      client.mutation(api.agentRunResources.recordNotStarted, {
        ...args,
        serviceKey,
      }),
  };
}

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function buildJournalLaunch(
  command: string,
  binding: Binding,
  executionTimeoutMs = 30 * 60 * 1000,
) {
  if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs <= 0)
    throw new Error("Invalid remote execution budget");
  const runKey = createHash("sha256")
    .update(
      JSON.stringify([
        binding.userId,
        binding.chatId,
        binding.claimId,
        binding.runId,
      ]),
    )
    .digest("hex");
  const directory = `/tmp/rift-remote-resources/${runKey}`;
  const receipt = `${directory}/${binding.resourceId}.json`;
  const payload = Buffer.from(
    JSON.stringify({
      command,
      directory,
      receipt,
      resourceId: binding.resourceId,
      budgetMs: Math.min(executionTimeoutMs, 30 * 60 * 1000),
    }),
  ).toString("base64");
  return {
    command: `exec python3 -c ${quote(REMOTE_COMMAND_SUPERVISOR)} ${quote(payload)}`,
    receipt,
    directory,
  };
}

/** The caller must invoke notStarted only if it has not called commands.run.
 * Once submitted, even a synchronous rejection is an uncertain remote outcome. */
export async function prepareJournaledCommand(
  command: string,
  sandbox: Sandbox,
  injectedStore?: JournalStore,
  executionTimeoutMs = 30 * 60 * 1000,
) {
  const owner = scope.getStore()?.owner;
  if (!owner) return undefined;
  const store = injectedStore ?? (await backendStore());
  const binding = {
    ...owner,
    resourceId: randomUUID(),
    sandboxId: sandbox.sandboxId,
  };
  const launch = buildJournalLaunch(command, binding, executionTimeoutMs);
  if (!(await store.reserve(binding)))
    throw new Error("Remote command launch was not authorized");
  let receipt: Promise<Receipt> | undefined;
  let remoteReceipt: Promise<Receipt> | undefined;
  let unsent = false;
  const readReceipt = async () => {
    // Retry only the idempotent file lookup. Parse and identity validation stay
    // outside this loop: invalid proof must never be accepted by retrying it.
    for (let attempt = 0; ; attempt++) {
      try {
        return await sandbox.files.read(launch.receipt, {
          user: "root",
          requestTimeoutMs: 1000,
        });
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
  const started = (pid: number) => {
    if (unsent) return Promise.reject(new Error("Command was not submitted"));
    if (!receipt) {
      remoteReceipt = (async () => {
        const remote = JSON.parse(await readReceipt());
        if (
          remote.resourceId !== binding.resourceId ||
          remote.pid !== pid ||
          !Number.isSafeInteger(pid) ||
          pid <= 0 ||
          typeof remote.processIdentity !== "string" ||
          !remote.processIdentity.startsWith("supervised-v1:") ||
          !remote.processIdentity.endsWith(`:${binding.resourceId}`)
        )
          throw new Error("Remote command receipt identity mismatch");
        const result = {
          ...binding,
          pid,
          processIdentity: remote.processIdentity,
        };
        return result;
      })();
      receipt = remoteReceipt.then(async (result) => {
        if (!(await store.started(result)))
          throw new Error("Remote start receipt was not saved");
        return result;
      });
      void receipt.catch(() => {});
    }
    return receipt.then((value) => {
      if (value.pid !== pid) throw new Error("Remote command PID changed");
      return value;
    });
  };
  return {
    command: launch.command,
    started,
    async exited(pid: number) {
      const value = await started(pid);
      const final = JSON.parse(await readReceipt());
      if (
        final.pid !== pid ||
        final.processIdentity !== value.processIdentity ||
        final.resourceId !== binding.resourceId ||
        final.state !== "exited" ||
        final.descendantsReaped !== true
      )
        throw new Error("Remote descendants have not been confirmed reaped");
      if (!(await store.exited(value)))
        throw new Error("Remote exit receipt was not saved");
    },
    async stop(pid: number) {
      void started(pid).catch(() => {});
      const value = await remoteReceipt!;
      if (value.pid !== pid) throw new Error("Remote command PID changed");
      const payload = Buffer.from(
        JSON.stringify({
          ...value,
          directory: launch.directory,
          receipt: launch.receipt,
        }),
      ).toString("base64");
      await sandbox.commands.run(
        `python3 -c ${quote(REMOTE_COMMAND_STOP)} ${quote(payload)}`,
        { user: "root", timeoutMs: 10000 },
      );
    },
    async notStarted() {
      if (receipt) throw new Error("Command already has a start receipt");
      unsent = true;
      if (!(await store.notStarted(binding)))
        throw new Error("Unsent command receipt was not saved");
    },
  };
}
