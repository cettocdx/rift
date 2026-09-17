import { describe, expect, it } from "@jest/globals";
import {
  AGENT_LONG_HEARTBEAT_INTERVAL_MS,
  AGENT_LONG_HEARTBEAT_PART_TYPE,
  stripAgentLongHeartbeatParts,
  stripAgentLongHeartbeatPartsFromMessages,
  withAgentLongStreamHeartbeat,
} from "../agent-long-heartbeat";

describe("agent-long heartbeat helpers", () => {
  it("uses a heartbeat interval below the 300 second quiet window", () => {
    expect(AGENT_LONG_HEARTBEAT_INTERVAL_MS).toBeLessThan(300_000);
  });

  it("strips heartbeat parts without touching visible parts", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: AGENT_LONG_HEARTBEAT_PART_TYPE, data: { at: 1 } },
        { type: "data-terminal", data: { terminal: "done", toolCallId: "t1" } },
      ],
    };

    expect(stripAgentLongHeartbeatParts(message)).toEqual({
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "data-terminal", data: { terminal: "done", toolCallId: "t1" } },
      ],
    });
  });

  it("returns the original array when no heartbeat parts are present", () => {
    const messages = [{ parts: [{ type: "text", text: "hello" }] }];

    expect(stripAgentLongHeartbeatPartsFromMessages(messages)).toBe(messages);
  });

  it("serially forwards source chunks and closes once", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("one");
        controller.enqueue("two");
        controller.close();
      },
    });
    const abortController = new AbortController();
    const wrapped = withAgentLongStreamHeartbeat({
      source,
      signal: abortController.signal,
      heartbeat: () => "heartbeat",
      intervalMs: 1_000,
    });

    const values: string[] = [];
    for await (const value of wrapped) values.push(value);

    expect(values).toEqual(["one", "two"]);
  });

  it("surfaces a source error through the reader without a background throw", async () => {
    const sourceError = new Error("source failed");
    const source = new ReadableStream<string>({
      pull() {
        throw sourceError;
      },
    });
    const abortController = new AbortController();
    const reader = withAgentLongStreamHeartbeat({
      source,
      signal: abortController.signal,
      heartbeat: () => "heartbeat",
      intervalMs: 1_000,
    }).getReader();

    await expect(reader.read()).rejects.toBe(sourceError);
  });

  it("emits a heartbeat while the source is idle", async () => {
    const source = new ReadableStream<string>({});
    const abortController = new AbortController();
    const reader = withAgentLongStreamHeartbeat({
      source,
      signal: abortController.signal,
      heartbeat: () => "heartbeat",
      intervalMs: 1,
    }).getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: "heartbeat",
    });
    await reader.cancel();
  });

  it("closes cleanly when the run signal aborts during an idle read", async () => {
    const source = new ReadableStream<string>({});
    const abortController = new AbortController();
    const reader = withAgentLongStreamHeartbeat({
      source,
      signal: abortController.signal,
      heartbeat: () => "heartbeat",
      intervalMs: 1_000,
    }).getReader();

    const pendingRead = reader.read();
    abortController.abort();

    await expect(pendingRead).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
