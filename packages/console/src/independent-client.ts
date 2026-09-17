import type {
  ConsoleCommand,
  ConsoleSnapshot,
  ConsoleChoice,
  ConsoleEntry,
} from "./protocol.js";
type Config = {
  model: string;
  models: ConsoleChoice[];
  modelEfforts: Record<string, ConsoleChoice[]>;
  permissions: ConsoleChoice[];
  targets: ConsoleChoice[];
};
/** Browser and CLI use separate IDs and the same durable RIFT Build API. */
export class IndependentConsoleClient {
  snapshot: ConsoleSnapshot;
  private listeners = new Set<() => void>();
  protected config: Config | null = null;
  private stream: AbortController | null = null;
  private closed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private stopped = false;
  private approvalsTimer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  constructor(
    private request: typeof fetch,
    chatId: string = crypto.randomUUID(),
    private remember?: (id: string) => void,
  ) {
    this.snapshot = {
      chatId,
      status: "unavailable",
      entries: [],
      model: "",
      modelLabel: "",
      effort: "medium",
      approval: "ask",
      mode: "agent",
      target: "e2b",
      targetLabel: "Cloud",
      models: [],
      efforts: [],
      permissions: [],
      modes: [{ value: "agent", label: "Build" }],
      targets: [],
      approvals: [],
      queued: 0,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  protected update(values: Partial<ConsoleSnapshot>) {
    this.snapshot = { ...this.snapshot, ...values };
    this.listeners.forEach((fn) => fn());
  }
  protected async checked(path: string, init?: RequestInit) {
    const response = await this.request(path, {
      ...init,
      signal:
        init?.signal ??
        (path === "/api/console/config"
          ? AbortSignal.timeout(10000)
          : undefined),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Sign in to RIFT. In Terminal, run rift login or set RIFT_API_KEY."
          : `RIFT request failed (${response.status}). Your task was not resent.`,
      );
    return response;
  }
  async initialize() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      this.config = await (await this.checked("/api/console/config")).json();
      const c = this.config!;
      const model = c.models.find((m) => m.value === c.model)!;
      this.update({
        status: "ready",
        model: model.value,
        modelLabel: model.label,
        models: c.models,
        efforts: c.modelEfforts[model.value],
        permissions: c.permissions,
        targets: c.targets,
      });
      const history = await (
        await this.checked(
          `/api/console/history?chatId=${encodeURIComponent(this.snapshot.chatId!)}`,
        )
      ).json();
      this.update({ entries: history.entries });
      this.remember?.(this.snapshot.chatId!);
      // Read-only recovery never submits another copy of a task.
      const response = await this.checked(
        `/api/console/stream?chatId=${encodeURIComponent(this.snapshot.chatId!)}`,
      );
      if (response.status !== 204) {
        this.update({ status: "streaming" });
        void this.follow(response);
      }
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  private fail(error: unknown) {
    if (this.closed) return;
    this.update({
      status: "error",
      entries: [
        ...this.snapshot.entries,
        {
          id: crypto.randomUUID(),
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "Connection interrupted. Reopen this console to resume the same task.",
        },
      ],
    });
  }
  async send(command: ConsoleCommand) {
    if (
      command.type === "submit" &&
      (!command.text.trim() || command.text.length > 32000)
    )
      throw new Error("Write a task of up to 32,000 characters.");
    if ("chatId" in command && command.chatId !== this.snapshot.chatId)
      throw new Error("This task belongs to another console session.");
    if (command.type === "answer")
      throw new Error(
        "Interactive answers are not supported by this Cloud session yet.",
      );
    if (command.type === "stop") {
      await this.checked("/api/agent-long/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: this.snapshot.chatId }),
      });
      this.stopped = true;
      this.stream?.abort();
      await this.reader?.cancel();
      this.update({ status: "ready", approvals: [] });
      return;
    }
    if (command.type === "approve") {
      await this.checked("/api/console/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      await this.loadApprovals();
      return;
    }
    if (this.busy || ["streaming", "submitted"].includes(this.snapshot.status))
      throw new Error(
        "A task is running. Stop it before changing this session.",
      );
    if (command.type === "new-chat") {
      const chatId = crypto.randomUUID();
      this.update({ chatId, entries: [], status: "ready", approvals: [] });
      this.remember?.(chatId);
      return;
    }
    if (command.type.startsWith("set-")) {
      const c = command as Extract<ConsoleCommand, { value: string }>;
      const key = c.type.slice(4) as
        | "model"
        | "effort"
        | "approval"
        | "mode"
        | "target";
      const choices =
        key === "model"
          ? this.snapshot.models
          : key === "effort"
            ? this.snapshot.efforts
            : key === "approval"
              ? this.snapshot.permissions
              : key === "target"
                ? this.snapshot.targets
                : this.snapshot.modes;
      const choice = choices?.find((v) => v.value === c.value);
      if (!choice) throw new Error("Unsupported selection");
      this.update({
        [key]: c.value,
        ...(key === "model"
          ? {
              modelLabel: choice.label,
              efforts: this.config!.modelEfforts[c.value],
              effort:
                this.config!.modelEfforts[c.value]?.find(
                  (e) => e.value === "medium",
                )?.value ??
                this.config!.modelEfforts[c.value]?.[0]?.value ??
                "off",
            }
          : {}),
        ...(key === "target" ? { targetLabel: choice.label } : {}),
      });
      return;
    }
    if (command.type !== "submit") return;
    this.busy = true;
    this.stopped = false;
    this.stream = new AbortController();
    const messageId = crypto.randomUUID();
    this.update({
      status: "submitted",
      entries: [
        ...this.snapshot.entries,
        { id: messageId, kind: "user", text: command.text },
      ],
    });
    try {
      const response = await this.checked("/api/console/stream", {
        method: "POST",
        signal: this.stream.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: this.snapshot.chatId,
          messages: [
            {
              id: messageId,
              role: "user",
              parts: [{ type: "text", text: command.text }],
            },
          ],
          selectedModel: this.snapshot.model,
          reasoningEffort: this.snapshot.effort,
          approvalMode: this.snapshot.approval,
          sandboxPreference: this.snapshot.target,
          purpose: "app",
        }),
      });
      this.update({ status: "streaming" });
      void this.follow(response);
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  private async follow(initialResponse: Response) {
    const stream = this.stream;
    const isCurrent = () =>
      !this.closed && !this.stopped && this.stream === stream;
    let response: Response | null = initialResponse;
    for (let attempt = 0; ; attempt++) {
      try {
        if (!isCurrent()) {
          await response?.body?.cancel().catch(() => undefined);
          return;
        }
        if (!response) {
          // Recovery is read-only even when the resume request itself fails.
          response = await this.checked(
            `/api/console/stream?chatId=${encodeURIComponent(this.snapshot.chatId!)}`,
            { signal: stream?.signal },
          );
          if (!isCurrent()) {
            await response.body?.cancel().catch(() => undefined);
            return;
          }
          if (response.status === 204) {
            const history = await (
              await this.checked(
                `/api/console/history?chatId=${encodeURIComponent(this.snapshot.chatId!)}`,
                { signal: stream?.signal },
              )
            ).json();
            if (isCurrent())
              this.update({
                status: "ready",
                entries: history.entries,
                approvals: [],
              });
            return;
          }
        }
        await this.consume(response, isCurrent);
        return;
      } catch (error) {
        if (!isCurrent()) return;
        if (attempt >= 2) {
          this.fail(error);
          return;
        }
        response = null;
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }
  }
  private async loadApprovals() {
    const r = await this.checked(
      `/api/console/approvals?chatId=${encodeURIComponent(this.snapshot.chatId!)}`,
    );
    const approvals = await r.json();
    if (
      !this.closed &&
      !this.stopped &&
      JSON.stringify(approvals) !== JSON.stringify(this.snapshot.approvals)
    )
      this.update({ approvals });
  }
  private async consume(response: Response, isCurrent: () => boolean) {
    if (!response.body) throw new Error("No response stream");
    const approvalsTimer = setInterval(
      () => void this.loadApprovals().catch(() => undefined),
      2000,
    );
    this.approvalsTimer = approvalsTimer;
    const reader = response.body.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    let assistantId = crypto.randomUUID();
    const append = (
      id: string,
      kind: ConsoleEntry["kind"],
      text: string,
      delta = false,
    ) => {
      const entries = [...this.snapshot.entries];
      const index = entries.findIndex((e) => e.id === id);
      const entry = {
        id,
        kind,
        text: delta && index >= 0 ? entries[index].text + text : text,
      };
      if (index < 0) entries.push(entry);
      else entries[index] = entry;
      this.update({ entries: entries.slice(-300) });
    };
    try {
      while (isCurrent()) {
        const { value, done } = await reader.read();
        if (!isCurrent()) break;
        buffer += decoder.decode(value, { stream: !done });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "start" && chunk.messageId) {
            assistantId = chunk.messageId;
            // Replayed deltas replace the persisted partial response.
            this.update({
              entries: this.snapshot.entries.filter(
                (entry) => !entry.id.startsWith(`${assistantId}:`),
              ),
            });
          }
          if (chunk.type === "text-delta")
            append(
              `${assistantId}:${chunk.id}`,
              "assistant",
              chunk.delta,
              true,
            );
          if (
            chunk.type === "reasoning-delta" &&
            typeof chunk.delta === "string"
          )
            append(
              `${assistantId}:reasoning:${chunk.id}`,
              "activity",
              chunk.delta,
              true,
            );
          if (chunk.type === "reasoning-start")
            append(`${assistantId}:thinking`, "activity", "Thinking…");
          if (chunk.type === "reasoning-end")
            append(`${assistantId}:thinking`, "activity", "Reasoning complete");
          if (chunk.type === "tool-input-available")
            append(
              `${assistantId}:${chunk.toolCallId}`,
              "activity",
              `Using ${chunk.toolName}`,
            );
          if (chunk.type === "tool-output-available")
            append(
              `${assistantId}:${chunk.toolCallId}`,
              "activity",
              "Tool completed",
            );
          if (chunk.type === "tool-output-error")
            append(
              `${assistantId}:${chunk.toolCallId}`,
              "error",
              chunk.errorText ?? "Tool failed",
            );
          if (chunk.type === "error") {
            append(
              `${assistantId}:error`,
              "error",
              chunk.errorText ?? "The task failed",
            );
            completed = true;
          }
          if (chunk.type === "finish" || chunk.type === "abort")
            completed = true;
        }
        if (done) break;
      }
      if (isCurrent()) {
        if (!completed)
          throw new Error(
            "Connection interrupted. Reopen this terminal to resume your task.",
          );
        this.update({ status: "ready", approvals: [] });
      }
    } finally {
      clearInterval(approvalsTimer);
      if (this.approvalsTimer === approvalsTimer)
        this.approvalsTimer = undefined;
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      if (this.reader === reader) this.reader = null;
    }
  }
  close() {
    this.closed = true;
    this.stream?.abort();
    void this.reader?.cancel().catch(() => undefined);
    clearInterval(this.approvalsTimer);
    this.listeners.clear();
  }
}
