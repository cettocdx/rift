import { validateConsoleCommand as isConsoleCommand } from "./command-validator.mjs";
import {
  type ConsoleCommand,
  type ConsoleEntry,
  type ConsoleSnapshot,
} from "./protocol.js";
// Public v2 wire subset, verified against app-server-protocol/schema/typescript/v2.
export type NativeConfig = {
  defaultModel: string;
  models: {
    id: string;
    label: string;
    providerModel: string;
    efforts: string[];
  }[];
};
export type NativeMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { message: string };
};
export function nativeSnapshot(
  message = "Choose a writable folder to start the native console.",
): ConsoleSnapshot {
  return {
    chatId: null,
    status: "unavailable",
    entries: message ? [{ id: "setup", kind: "activity", text: message }] : [],
    model: "",
    modelLabel: "",
    effort: "",
    approval: "ask",
    mode: "agent",
    target: "native",
    targetLabel: "Native · local workspace",
    models: [],
    efforts: [],
    targets: [{ value: "native", label: "Native · local workspace" }],
    permissions: [{ value: "ask", label: "Ask" }],
    modes: [{ value: "agent", label: "Agent" }],
    approvals: [],
    questions: [],
    queued: 0,
  };
}
export class NativeConsoleClient {
  snapshot = nativeSnapshot("");
  private listeners = new Set<() => void>();
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      apply?: (value: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private resolvedRequests = new Set<string>();
  private requests = new Map<string, NativeMessage>();
  private answers = new Map<string, Record<string, { answers: string[] }>>();
  private turnId: string | null = null;
  private busy = false;
  private stopping = false;
  private interrupted: string | null = null;
  private dead = false;
  private completed = new Set<string>();
  private adoptUnclaimedThread: boolean;
  constructor(
    private options: {
      send: (m: NativeMessage) => Promise<void>;
      config: NativeConfig;
      workspace: string;
      persist?: (threadId: string | null) => void;
      adoptReplayThread?: boolean;
    },
  ) {
    this.adoptUnclaimedThread = options.adoptReplayThread !== false;
    this.snapshot = {
      ...this.snapshot,
      status: "ready",
      targetLabel: `Native · ${options.workspace}`,
      models: options.config.models.map((m) => ({
        value: m.id,
        label: m.label,
      })),
    };
    this.model(options.config.defaultModel);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.snapshot = {
      ...this.snapshot,
      entries: this.snapshot.entries.slice(-500),
    };
    this.listeners.forEach((l) => l());
  }
  private model(id: string) {
    const model = this.options.config.models.find((m) => m.id === id);
    if (!model) throw new Error("Native model is not available.");
    this.snapshot = {
      ...this.snapshot,
      model: id,
      modelLabel: model.label,
      efforts: model.efforts.map((value) => ({ value, label: value })),
      effort: model.efforts.includes(this.snapshot.effort)
        ? this.snapshot.effort
        : (model.efforts[0] ?? ""),
    };
  }
  private entry(entry: ConsoleEntry) {
    const old = this.snapshot.entries.findIndex((e) => e.id === entry.id);
    this.snapshot.entries =
      old < 0
        ? [...this.snapshot.entries, entry]
        : this.snapshot.entries.map((e, i) => (i === old ? entry : e));
  }
  fail(error: unknown) {
    this.dead = true;
    this.busy = false;
    this.turnId = null;
    this.snapshot.status = "error";
    this.snapshot.approvals = [];
    this.snapshot.questions = [];
    this.entry({
      id: "native-error",
      kind: "error",
      text: error instanceof Error ? error.message : String(error),
    });
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        new Error(
          "Native connection ended. Resume saved history explicitly; previous input will not be resent.",
        ),
      );
    }
    this.pending.clear();
    this.emit();
  }
  dispose() {
    this.fail(new Error("Native console disconnected."));
    this.listeners.clear();
  }
  rpc(
    method: string,
    params: Record<string, unknown>,
    apply?: (value: any) => void,
  ): Promise<any> {
    if (this.dead)
      return Promise.reject(
        new Error(
          "Native console disconnected. Reconnect to resume saved history.",
        ),
      );
    const id = `ui-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.fail(
          new Error(
            "Native response timed out. Execution may have continued. Reconnect to inspect saved history; do not repeat the task.",
          ),
        );
        reject(new Error("Native response timed out."));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer, apply });
      void this.options.send({ id, method, params }).catch((e) => this.fail(e));
    });
  }
  restore(thread: any) {
    this.snapshot.chatId = thread.id;
    this.options.persist?.(thread.id);
    this.snapshot.entries = [];
    this.turnId = null;
    this.busy = false;
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) this.item(item);
      if (turn.status === "inProgress") {
        this.turnId = turn.id;
        this.busy = true;
      } else this.completed.add(turn.id);
    }
    this.snapshot.status = this.busy ? "streaming" : "ready";
    this.emit();
  }
  private item(item: any) {
    if (item.type === "agentMessage")
      this.entry({ id: item.id, kind: "assistant", text: item.text ?? "" });
    else if (item.type === "userMessage")
      this.entry({
        id: item.id,
        kind: "user",
        text: (item.content ?? [])
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n"),
      });
    else if (item.type === "reasoning") {
      if (item.summary?.length)
        this.entry({
          id: item.id,
          kind: "activity",
          text: item.summary.join("\n"),
        });
    } else if (item.type === "commandExecution")
      this.entry({
        id: item.id,
        kind: "activity",
        text: item.command ?? "Running command",
        details: item.aggregatedOutput ?? undefined,
      });
    else if (item.type === "fileChange")
      this.entry({
        id: item.id,
        kind: "activity",
        text: "File changes",
        details: (item.changes ?? [])
          .map((c: any) => `${c.path}\n${c.diff ?? ""}`)
          .join("\n"),
      });
    else if (item.type === "plan")
      this.entry({ id: item.id, kind: "activity", text: item.text });
  }
  private async sendResponse(message: NativeMessage) {
    try {
      await this.options.send(message);
    } catch (error) {
      const failure = new Error(
        "Native approval or answer delivery is uncertain. Disconnect, then reconnect to inspect saved history. This response will not be resent automatically.",
      );
      this.fail(failure);
      throw failure;
    }
  }
  private removeRequest(key: string): boolean {
    this.resolvedRequests.add(key);
    this.requests.delete(key);
    this.answers.delete(key);
    const approvals = this.snapshot.approvals.filter((a) => a.id !== key);
    const questions = this.snapshot.questions?.filter(
      (q) => !q.id.startsWith(`${key}:`),
    );
    const changed =
      approvals.length !== this.snapshot.approvals.length ||
      questions?.length !== this.snapshot.questions?.length;
    if (changed) {
      this.snapshot.approvals = approvals;
      this.snapshot.questions = questions;
    }
    return changed;
  }
  /** Called only after a poll batch is fully drained: native owns outstanding requests. */
  reconcileRequests(outstanding: NativeMessage[]) {
    if (this.dead) return;
    const ids = new Set(outstanding.map((r) => String(r.id)));
    let removedControls = false;
    for (const key of this.requests.keys()) {
      if (!ids.has(key))
        removedControls = this.removeRequest(key) || removedControls;
    }
    if (removedControls) this.emit();
    // New requests publish through receive; duplicate/resolved requests are no-ops.
    for (const request of outstanding) this.receive(request);
  }
  private interrupt() {
    if (!this.turnId || this.interrupted === this.turnId) return;
    this.interrupted = this.turnId;
    void this.rpc("turn/interrupt", {
      threadId: this.snapshot.chatId,
      turnId: this.turnId,
    }).catch((e) => this.fail(e));
  }
  receive(message: NativeMessage) {
    if (this.dead) return;
    if (!message.method && message.id !== undefined) {
      const p = this.pending.get(String(message.id));
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(String(message.id));
        if (message.error) p.reject(new Error(message.error.message));
        else {
          try {
            p.apply?.(message.result);
            p.resolve(message.result);
          } catch (error) {
            p.reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
      return;
    }
    const p = message.params ?? {};
    // Replay may discover the running thread before any read request.
    if (message.method === "thread/started") {
      if (!this.snapshot.chatId && this.adoptUnclaimedThread) {
        this.snapshot.chatId = p.thread.id;
        this.options.persist?.(p.thread.id);
        this.emit();
      }
      return;
    }
    if (p.threadId && p.threadId !== this.snapshot.chatId) return;
    if (p.turnId && p.turnId !== this.turnId) return;
    if (message.method === "serverRequest/resolved") {
      if (this.removeRequest(String(p.requestId))) this.emit();
      return;
    }
    if (message.id !== undefined) {
      const key = String(message.id);
      if (this.requests.has(key) || this.resolvedRequests.has(key)) return;
      if (
        message.method === "item/commandExecution/requestApproval" ||
        message.method === "item/fileChange/requestApproval"
      ) {
        this.requests.set(key, message);
        const item = this.snapshot.entries.find((e) => e.id === p.itemId);
        this.snapshot.approvals = [
          ...this.snapshot.approvals,
          {
            id: key,
            toolName: message.method.includes("commandExecution")
              ? "Command"
              : "File change",
            preview:
              [p.command, p.cwd, p.reason, item?.details]
                .filter(Boolean)
                .join("\n") || "Review the requested file access.",
          },
        ];
      } else if (message.method === "mcpServer/elicitation/request") {
        const schema = p.requestedSchema;
        const properties = schema?.properties;
        if (
          p.mode !== "form" ||
          schema?.type !== "object" ||
          !properties ||
          typeof properties !== "object" ||
          Array.isArray(properties) ||
          Object.keys(properties).length !== 0 ||
          (schema.required !== undefined &&
            (!Array.isArray(schema.required) ||
              schema.required.length !== 0)) ||
          p._meta?.codex_approval_kind !== "mcp_tool_call" ||
          typeof p.serverName !== "string" ||
          typeof p.message !== "string"
        ) {
          this.fail(
            new Error(
              "Unsupported MCP elicitation. Only an empty-form tool confirmation can be approved here. Disconnect this native session, then reconnect to saved history to recover.",
            ),
          );
          return;
        }
        this.requests.set(key, message);
        this.snapshot.approvals = [
          ...this.snapshot.approvals,
          {
            id: key,
            toolName: `MCP · ${p.serverName}`,
            preview: [
              p.message,
              `Server: ${p.serverName}`,
              p._meta.tool_description,
              p._meta.tool_params === undefined
                ? undefined
                : `Tool parameters:\n${JSON.stringify(p._meta.tool_params, null, 2)}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ];
      } else if (message.method === "item/tool/requestUserInput") {
        if (
          !Array.isArray(p.questions) ||
          p.questions.length > 3 ||
          p.questions.some((q: any) => q.isSecret)
        ) {
          this.fail(
            new Error(
              "Native request requires unsupported questions. Disconnect this native session, then reconnect to saved history, then ask the agent to use up to three non-secret questions.",
            ),
          );
          return;
        }
        this.requests.set(key, message);
        this.snapshot.questions = [
          ...(this.snapshot.questions ?? []),
          ...p.questions.map((q: any) => ({
            id: `${key}:${q.id}`,
            title: q.question,
            options: (q.options ?? []).map((o: any) => o.label),
          })),
        ];
      } else {
        this.fail(
          new Error(
            `Unsupported native request: ${message.method}. Disconnect this native session, then reconnect to saved history to recover.`,
          ),
        );
        return;
      }
    } else if (message.method === "turn/started") {
      if (this.completed.has(p.turn.id)) return;
      this.turnId = p.turn.id;
      this.busy = true;
      this.snapshot.status = "streaming";
      if (this.stopping) this.interrupt();
    } else if (message.method === "turn/completed") {
      if (p.turn.id !== this.turnId) return;
      this.completed.add(p.turn.id);
      this.turnId = null;
      this.busy = false;
      this.stopping = false;
      this.requests.clear();
      this.answers.clear();
      this.snapshot.approvals = [];
      this.snapshot.questions = [];
      this.snapshot.status = p.turn.status === "failed" ? "error" : "ready";
      if (p.turn.error)
        this.entry({
          id: `error-${p.turn.id}`,
          kind: "error",
          text: p.turn.error.message,
        });
    } else if (
      message.method === "item/started" ||
      message.method === "item/completed"
    ) {
      const previousEntries = this.snapshot.entries;
      this.item(p.item);
      if (this.snapshot.entries === previousEntries) return;
    } else if (message.method === "item/agentMessage/delta") {
      const existing = this.snapshot.entries.find((e) => e.id === p.itemId);
      this.entry({
        id: p.itemId,
        kind: "assistant",
        text: (existing?.text ?? "") + p.delta,
      });
    } else if (message.method === "item/commandExecution/outputDelta") {
      const existing = this.snapshot.entries.find((e) => e.id === p.itemId);
      this.entry({
        id: p.itemId,
        kind: "activity",
        text: existing?.text ?? "Command output",
        details: (existing?.details ?? "") + p.delta,
      });
    } else if (message.method === "error") {
      this.entry({
        id: `error-${p.turnId}`,
        kind: "error",
        text: p.error.message,
      });
      if (!p.willRetry) this.snapshot.status = "error";
    } else {
      return;
    }
    this.emit();
  }
  async command(
    command: ConsoleCommand,
  ): Promise<{ accepted: boolean; error?: string }> {
    let ownsSubmit = false;
    try {
      if (!isConsoleCommand(command))
        throw new Error("Invalid console command.");
      if (this.dead)
        throw new Error(
          "Native console disconnected. Reconnect to resume saved history.",
        );
      if (
        "chatId" in command &&
        command.chatId !== this.snapshot.chatId &&
        !(
          command.type === "stop" &&
          command.chatId === null &&
          this.busy &&
          this.snapshot.status === "submitted"
        )
      )
        throw new Error("This command belongs to a different native thread.");
      if (command.type === "stop") {
        this.stopping = true;
        this.interrupt();
        return { accepted: true };
      }
      if (command.type === "approve") {
        const request = this.requests.get(command.id);
        if (
          !request ||
          (!request.method?.endsWith("requestApproval") &&
            request.method !== "mcpServer/elicitation/request")
        )
          throw new Error("Approval expired.");
        this.removeRequest(command.id);
        this.snapshot.approvals = this.snapshot.approvals.filter(
          (a) => a.id !== command.id,
        );
        await this.sendResponse({
          id: request.id,
          result:
            request.method === "mcpServer/elicitation/request"
              ? {
                  action: command.approve ? "accept" : "decline",
                  content: command.approve ? {} : null,
                  _meta: null,
                }
              : { decision: command.approve ? "accept" : "decline" },
        });
      } else if (command.type === "answer") {
        const pair = [...this.requests].find(
          ([key, r]) =>
            r.method === "item/tool/requestUserInput" &&
            r.params?.questions.some(
              (q: any) => `${key}:${q.id}` === command.id,
            ),
        );
        if (!pair) throw new Error("Question expired.");
        const [key, request] = pair;
        const question = request.params!.questions.find(
          (q: any) => `${key}:${q.id}` === command.id,
        );
        const answers = this.answers.get(key) ?? {};
        answers[question.id] = { answers: [command.text] };
        this.answers.set(key, answers);
        this.snapshot.questions = this.snapshot.questions?.filter(
          (q) => q.id !== command.id,
        );
        if (request.params!.questions.every((q: any) => answers[q.id])) {
          this.removeRequest(key);
          this.answers.delete(key);
          await this.sendResponse({ id: request.id, result: { answers } });
        }
      } else if (command.type === "submit") {
        if (this.busy) throw new Error("A native turn is already running.");
        ownsSubmit = true;
        this.busy = true;
        this.stopping = false;
        this.interrupted = null;
        this.snapshot.status = "submitted";
        this.emit();
        if (!this.snapshot.chatId) {
          const response = await this.rpc("thread/start", {
            model: this.snapshot.model,
          });
          this.snapshot.chatId = response.thread.id;
          this.options.persist?.(response.thread.id);
        }
        const response = await this.rpc("turn/start", {
          threadId: this.snapshot.chatId,
          input: [{ type: "text", text: command.text, text_elements: [] }],
          model: this.snapshot.model,
          effort: this.snapshot.effort,
        });
        if (!this.completed.has(response.turn.id)) {
          this.turnId = response.turn.id;
          if (this.stopping) this.interrupt();
        }
      } else {
        if (this.busy)
          throw new Error("Stop the active turn before changing settings.");
        if (command.type === "new-chat") {
          this.adoptUnclaimedThread = false;
          this.snapshot.chatId = null;
          this.snapshot.entries = [];
          this.options.persist?.(null);
        } else if (command.type === "set-model") this.model(command.value);
        else if (command.type === "set-effort") {
          if (!this.snapshot.efforts.some((e) => e.value === command.value))
            throw new Error("Unsupported native effort.");
          this.snapshot.effort = command.value;
        } else if (
          !(
            (
              {
                "set-mode": "agent",
                "set-target": "native",
                "set-approval": "ask",
              } as Record<string, string>
            )[command.type] === command.value
          )
        )
          throw new Error(
            "Native supports local Agent mode with Ask approvals only.",
          );
      }
      this.emit();
      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ownsSubmit && this.snapshot.status === "submitted") {
        this.busy = false;
        this.snapshot.status = "error";
        this.entry({ id: "submit-error", kind: "error", text: message });
        this.emit();
      }
      return { accepted: false, error: message };
    }
  }
}
