import { describe, expect, it, jest } from "@jest/globals";
import { createJsonSseParser } from "../interactive-terminal-sse";

describe("createJsonSseParser", () => {
  it("parses JSON events split across byte chunks", () => {
    const messages: Array<{ type: string; data: string }> = [];
    const parser = createJsonSseParser<(typeof messages)[number]>((message) =>
      messages.push(message),
    );
    const encoder = new TextEncoder();

    parser.push(encoder.encode('data: {"type":"out'));
    parser.push(encoder.encode('put","data":"aGVs'));
    parser.push(encoder.encode('bG8="}\n\n'));
    parser.finish();

    expect(messages).toEqual([{ type: "output", data: "aGVsbG8=" }]);
  });

  it("supports CRLF, multi-line data, and ignores SSE metadata", () => {
    const onMessage = jest.fn<(message: { value: string }) => void>();
    const parser = createJsonSseParser(onMessage);

    parser.push(
      ': keepalive\r\nid: 4\r\nevent: terminal\r\ndata: {"value":\r\ndata: "ready"}\r\n\r\n',
    );

    expect(onMessage).toHaveBeenCalledWith({ value: "ready" });
  });

  it("flushes a final event without a trailing blank line", () => {
    const onMessage = jest.fn<(message: { type: string }) => void>();
    const parser = createJsonSseParser(onMessage);

    parser.push('data: {"type":"exit"}');
    expect(onMessage).not.toHaveBeenCalled();
    parser.finish();

    expect(onMessage).toHaveBeenCalledWith({ type: "exit" });
  });

  it("rejects malformed JSON frames", () => {
    const parser = createJsonSseParser(jest.fn());

    expect(() => parser.push("data: not-json\n\n")).toThrow(
      "The terminal event stream returned invalid JSON.",
    );
  });

  it("does not mask consumer errors as JSON failures", () => {
    const parser = createJsonSseParser(() => {
      throw new Error("invalid terminal event shape");
    });

    expect(() => parser.push('data: {"type":"unknown"}\n\n')).toThrow(
      "invalid terminal event shape",
    );
  });
});
