/** @jest-environment node */
import { createUIMessageStream } from "ai";
import { ChatSDKError } from "@/lib/errors";
import { createChatStreamErrorHandler } from "../chat-stream-error";

it("reports failures in merged streams, which never reach the route's outer catch", async () => {
  const error = new Error("response persistence failed");
  const emitUnexpectedError = jest.fn();
  const stream = createUIMessageStream({
    onError: createChatStreamErrorHandler({
      emitUnexpectedError,
      emitChatError: jest.fn(),
    }),
    execute({ writer }) {
      writer.merge(
        new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        }),
      );
    },
  });
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  expect(emitUnexpectedError).toHaveBeenCalledTimes(1);
  expect(emitUnexpectedError).toHaveBeenCalledWith(error);
  expect(chunks).toEqual([{ type: "error", errorText: expect.any(String) }]);
  expect(JSON.stringify(chunks)).not.toContain("response persistence failed");
});

it("preserves actionable application errors and reports their original metadata", () => {
  const error = new ChatSDKError(
    "bad_request:stream",
    "Upload could not be saved",
  );
  const sink = { emitUnexpectedError: jest.fn(), emitChatError: jest.fn() };
  expect(createChatStreamErrorHandler(sink)(error)).toBe(
    "Upload could not be saved",
  );
  expect(sink.emitChatError).toHaveBeenCalledWith(error);
  expect(sink.emitUnexpectedError).not.toHaveBeenCalled();
});
