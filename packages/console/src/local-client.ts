import {
  detectDoomLoop,
  generateDoomLoopNudge,
  type MinimalStep,
} from "./harness-progress.js";
import { randomUUID } from "node:crypto";
import { createExecutionLedger } from "./harness-execution.js";
import { IndependentConsoleClient } from "./independent-client.js";
import { executeLocalTool } from "./local-tools.js";
import { localToolNeedsApproval } from "./local-tool-schema.js";
import type { ConsoleCommand, ConsoleEntry } from "./protocol.js";

type Part = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: { type: string; value: string };
};
export type LocalMessage = { role: string; content: string | Part[] };
export type LocalState = {
  id: string;
  messages: LocalMessage[];
  entries: ConsoleEntry[];
  pending?: string;
  model?: string;
  effort?: string;
};
/** Keep confirmed results; only unresolved calls from the latest step are uncertain. */
function unresolvedLatestCalls(messages: LocalMessage[]): Part[] {
  let index = messages.length - 1;
  while (index >= 0 && messages[index].role !== "assistant") index--;
  const assistant = messages[index];
  if (!assistant || !Array.isArray(assistant.content)) return [];
  const resolved = new Set(
    messages
      .slice(index + 1)
      .flatMap((m) =>
        m.role === "tool" && Array.isArray(m.content)
          ? m.content.map((p) => p.toolCallId)
          : [],
      ),
  );
  return assistant.content.filter(
    (p) => p.type === "tool-call" && !resolved.has(p.toolCallId),
  );
}
function resolveInterruptedCalls(messages: LocalMessage[], reason: string) {
  const missing = unresolvedLatestCalls(messages);
  if (missing.length) {
    const content: Part[] = missing.map((p) => ({
      type: "tool-result",
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      output: { type: "error-text", value: reason },
    }));
    const last = messages.at(-1);
    if (last?.role === "tool" && Array.isArray(last.content))
      last.content.push(...content);
    else messages.push({ role: "tool", content });
  }
}
/** The terminal owns this loop, its file tools, approvals and persistent history. */
export class LocalConsoleClient extends IndependentConsoleClient {
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private answer: ((text: string) => void) | null = null;
  private approval: ((allow: boolean) => void) | null = null;
  constructor(
    request: typeof fetch,
    private cwd: string,
    private state: LocalState,
    private persist: (state: LocalState) => Promise<void>,
    private instructions = "",
    private execute = executeLocalTool,
  ) {
    super(request, state.id);
  }
  override async initialize() {
    this.config = await (await this.checked("/api/console/config")).json();
    const c = this.config!;
    const model =
      c.models.find((m) => m.value === this.state.model) ??
      c.models.find((m) => m.value === c.model) ??
      c.models[0];
    if (!model) throw new Error("No Build models available");
    const efforts = c.modelEfforts[model.value] ?? [];
    const missing = unresolvedLatestCalls(this.state.messages);
    const resumeSafe =
      this.state.messages.some((m) => m.role === "user") &&
      (!this.state.model || this.state.model === model.value) &&
      ((this.state.pending === "model response" && missing.length === 0) ||
        (this.state.pending === "local tool execution" &&
          missing.every(
            (c) => c.toolName === "read_file" || c.toolName === "list_files",
          )));
    if (this.state.pending) {
      this.state.entries.push({
        id: randomUUID(),
        kind: resumeSafe ? "activity" : "error",
        text: resumeSafe
          ? "Resuming the interrupted task from saved progress…"
          : `Previous session interrupted during ${this.state.pending}. No command was replayed. Inspect the project before retrying.`,
      });
      // Resolve outstanding calls as uncertain, never execute them again on reopen.
      resolveInterruptedCalls(
        this.state.messages,
        resumeSafe
          ? "Read interrupted before its result was saved. Inspect the current file again if needed."
          : "Session interrupted; execution outcome unknown. Inspect state before retrying.",
      );
      if (!resumeSafe) this.state.pending = undefined;
    }
    this.update({
      status: "ready",
      model: model.value,
      modelLabel: model.label,
      models: c.models,
      efforts,
      effort:
        efforts.find((e) => e.value === this.state.effort)?.value ??
        efforts.find((e) => e.value === "medium")?.value ??
        efforts[0]?.value ??
        "off",
      permissions: c.permissions,
      target: "local",
      targetLabel: "Local",
      targets: [{ value: "local", label: "This Mac" }],
      entries: this.state.entries,
    });
    await this.save();
    if (resumeSafe) this.startRun();
  }
  private async save() {
    this.state.entries = this.snapshot.entries;
    this.state.model = this.snapshot.model;
    this.state.effort = this.snapshot.effort;
    await this.persist(structuredClone(this.state));
  }
  private entry(
    id: string,
    kind: ConsoleEntry["kind"],
    text: string,
    delta = false,
    details?: string,
  ) {
    const entries = [...this.snapshot.entries];
    const index = entries.findIndex((e) => e.id === id);
    const item = {
      id,
      kind,
      ...(details ? { details: details.slice(0, 60000) } : {}),
      text: (delta && index >= 0 ? entries[index].text + text : text).slice(
        -100000,
      ),
    };
    if (index < 0) entries.push(item);
    else entries[index] = item;
    this.update({ entries: entries.slice(-300) });
  }
  override async send(command: ConsoleCommand) {
    if ("chatId" in command && command.chatId !== this.snapshot.chatId)
      throw new Error("This is another terminal session.");
    if (command.type === "stop") {
      this.controller?.abort();
      this.approval?.(false);
      await this.running;
      return;
    }
    if (command.type === "answer") {
      if (
        !this.answer ||
        !this.snapshot.questions?.some((q) => q.id === command.id) ||
        !command.text.trim() ||
        command.text.length > 32000
      )
        throw new Error("Question expired or answer invalid.");
      const answer = this.answer;
      this.answer = null;
      this.update({ questions: [] });
      answer(command.text);
      return;
    }
    if (command.type === "approve") {
      if (
        !this.snapshot.approvals.some((a) => a.id === command.id) ||
        !this.approval
      )
        throw new Error("Approval expired.");
      this.approval(command.approve);
      return;
    }
    if (this.running)
      throw new Error(
        "A task is running. Stop it before changing this session.",
      );
    if (command.type === "new-chat") {
      this.state = { id: randomUUID(), messages: [], entries: [] };
      this.update({
        chatId: this.state.id,
        entries: [],
        status: "ready",
        approvals: [],
      });
      await this.save();
      return;
    }
    if (command.type !== "submit") {
      await super.send(command);
      await this.save();
      return;
    }
    if (!command.text.trim() || command.text.length > 32000)
      throw new Error("Write a task of up to 32,000 characters.");
    this.state.messages.push({ role: "user", content: command.text });
    this.entry(randomUUID(), "user", command.text);
    this.startRun();
  }
  private async askQuestion(
    id: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 2000 ||
      !Array.isArray(input.options) ||
      input.options.length < 2 ||
      input.options.length > 6 ||
      !input.options.every(
        (o) => typeof o === "string" && o.trim() && o.length <= 500,
      )
    )
      throw new Error(
        "Invalid question. Provide a title and 2–6 concise options.",
      );
    signal.throwIfAborted();
    const text = await new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.answer = null;
        this.update({ questions: [] });
        reject(new Error("Question interrupted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.answer = (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      };
      this.update({
        questions: [
          {
            id,
            title: input.title as string,
            options: input.options as string[],
          },
        ],
      });
    });
    this.entry(id + ":answer", "user", text);
    return text;
  }
  private startRun() {
    this.controller = new AbortController();
    this.update({ status: "submitted" });
    this.running = this.run(this.controller.signal).finally(() => {
      this.running = null;
      this.controller = null;
      this.approval = null;
      this.answer = null;
      this.update({ status: "ready", approvals: [], questions: [] });
    });
    // Acceptance is immediate; input and Stop stay responsive during the model loop.
    void this.running.catch(() => undefined);
  }
  private async run(signal: AbortSignal) {
    try {
      const progress: MinimalStep[] = [];
      const executionLedger = createExecutionLedger();
      let progressHint = "";
      for (let step = 0; step < 80; step++) {
        signal.throwIfAborted();
        this.state.pending = "model response";
        await this.save();
        const response = await this.checked("/api/console/model", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.snapshot.model,
            effort: this.snapshot.effort,
            messages: this.state.messages,
            instructions: [this.instructions, progressHint]
              .filter(Boolean)
              .join("\n\n"),
          }),
        });
        if (!response.body) throw new Error("Missing model stream");
        this.update({ status: "streaming" });
        const id = randomUUID();
        let complete: LocalMessage[] | undefined;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let end;
            while ((end = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "text")
                this.entry(id, "assistant", event.text, true);
              if (event.type === "reasoning" && typeof event.text === "string")
                this.entry(id + ":reasoning", "activity", event.text, true);
              if (event.type === "thinking")
                this.entry(id + ":thinking", "activity", "Thinking…");
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "complete") complete = event.messages;
            }
            if (buffer.length > 20 * 1024 * 1024)
              throw new Error("Model response too large");
            if (done) break;
          }
        } finally {
          // A parse/protocol failure must also stop the remote SDK generation.
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
          this.update({
            entries: this.snapshot.entries.filter(
              (e) => e.id !== id + ":thinking",
            ),
          });
        }
        signal.throwIfAborted();
        if (!complete || !Array.isArray(complete))
          throw new Error("Response interrupted. No local tool was executed.");
        const calls = complete.flatMap((m) =>
          m.role === "assistant" && Array.isArray(m.content)
            ? m.content.filter((p) => p.type === "tool-call")
            : [],
        );
        // Validate the entire proposed batch before committing or running any call.
        const seen = new Set(
          this.state.messages.flatMap((message) =>
            message.role === "assistant" && Array.isArray(message.content)
              ? message.content
                  .filter((part) => part.type === "tool-call")
                  .map((part) => part.toolCallId)
              : [],
          ),
        );
        for (const call of calls) {
          if (!call.toolCallId || seen.has(call.toolCallId))
            throw new Error(
              "Model returned a missing or duplicate tool call identity. No new action was executed.",
            );
          if (
            !call.toolName ||
            !call.input ||
            typeof call.input !== "object" ||
            Array.isArray(call.input)
          )
            throw new Error(
              "Model returned an invalid tool request. No new action was executed.",
            );
          seen.add(call.toolCallId);
        }
        this.state.messages.push(...complete);
        if (!calls.length) {
          this.state.pending = undefined;
          await this.save();
          return;
        }
        // Persist intent before any side effect. Recovery records uncertainty,
        // rather than running a partially completed command a second time.
        this.state.pending = "local tool execution";
        await this.save();
        const results: Part[] = [];
        this.state.messages.push({ role: "tool", content: results });
        for (const call of calls) {
          signal.throwIfAborted();
          const name = call.toolName!;
          const input = call.input ?? {};
          const callId = call.toolCallId!;
          let output: string;
          try {
            if (localToolNeedsApproval(this.snapshot.approval, name)) {
              const preview = JSON.stringify(input, null, 2);
              if (preview.length > 16000)
                throw new Error(
                  "Action preview exceeds 16,000 characters. Split this into smaller edits or commands for review.",
                );
              const allowed = await new Promise<boolean>((resolve) => {
                this.approval = resolve;
                this.update({
                  approvals: [{ id: callId, toolName: name, preview }],
                });
              });
              this.approval = null;
              this.update({ approvals: [] });
              signal.throwIfAborted();
              if (!allowed) {
                results.push({
                  type: "tool-result",
                  toolCallId: callId,
                  toolName: name,
                  output: {
                    type: "error-text",
                    value:
                      "Operator denied this action. Do not retry or bypass it.",
                  },
                });
                this.entry(callId, "activity", `Denied ${name}`);
                await this.save();
                continue;
              }
            }
            this.entry(
              callId,
              "activity",
              `${name}: ${String(input.path ?? input.command ?? "").slice(0, 240)}`,
            );
            output =
              name === "ask_question"
                ? await this.askQuestion(callId, input, signal)
                : await executionLedger.run({ id: callId, name, input }, () =>
                    this.execute(this.cwd, name, input, signal),
                  );
            const path = String(input.path ?? "");
            const summary =
              name === "ask_question"
                ? "Answered your question"
                : name === "read_file"
                  ? `Read ${path}`
                  : name === "list_files"
                    ? `Listed ${path} · ${output ? output.split("\n").length : 0} entries`
                    : name === "write_file" || name === "edit_file"
                      ? `Updated ${path}`
                      : `Ran ${String(input.command ?? name)
                          .split("\n")[0]
                          .slice(0, 160)}`;
            this.entry(callId, "activity", summary, false, output);
            results.push({
              type: "tool-result",
              toolCallId: callId,
              toolName: name,
              output: { type: "text", value: output },
            });
          } catch (error) {
            if (signal.aborted) throw error;
            output = error instanceof Error ? error.message : "Tool failed";
            results.push({
              type: "tool-result",
              toolCallId: callId,
              toolName: name,
              output: { type: "error-text", value: output },
            });
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
            this.entry(
              callId,
              "error",
              missing ? `Not found: ${String(input.path ?? "file")}` : output,
            );
          }
          // Durably record each result before starting the next side effect.
          await this.save();
        }
        // Keep continuation intent durable between the last tool and next request.
        this.state.pending = "model response";
        await this.save();
        progress.push({
          toolCalls: calls.map((call) => ({
            toolName: call.toolName!,
            input: call.input,
          })),
          toolResults: results.map((result) => ({
            toolName: result.toolName,
            output: result.output,
          })),
        });
        const loop = detectDoomLoop(progress);
        if (loop.severity === "halt")
          throw new Error(
            "Stopped repeated tool calls without progress. Completed changes are saved; inspect the result before continuing.",
          );
        progressHint =
          loop.severity === "warning" ? generateDoomLoopNudge(loop) : "";
      }
      throw new Error(
        "Reached 80 model steps. Review progress and send a follow-up to continue.",
      );
    } catch (error) {
      // Any unmatched calls are resolved without replay, including a Stop midway.
      resolveInterruptedCalls(
        this.state.messages,
        "Interrupted. Outcome may be partial; inspect state before another attempt.",
      );
      this.state.pending = undefined;
      this.entry(
        randomUUID(),
        signal.aborted ? "activity" : "error",
        signal.aborted
          ? "Stopped. Completed changes remain in your project."
          : error instanceof Error
            ? error.message
            : "Local task failed",
      );
      await this.save();
    }
  }
  override close() {
    this.controller?.abort();
    this.approval?.(false);
    super.close();
  }
  async shutdown() {
    this.close();
    await this.running;
  }
}
