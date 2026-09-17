import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "../read-limited-body";
import { Request as EdgeRequest } from "next/dist/compiled/@edge-runtime/primitives/fetch";

const encoder = new TextEncoder();

describe("readLimitedTextBody", () => {
  it("reads a chunked UTF-8 body within the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("mer"));
        controller.enqueue(encoder.encode("haba 🐼"));
        controller.close();
      },
    });
    const request = new EdgeRequest("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);

    await expect(
      readLimitedTextBody(request as unknown as Request, 32),
    ).resolves.toBe("merhaba 🐼");
  });

  it("cancels a chunked request as soon as the byte limit is crossed", async () => {
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("1234"));
        controller.enqueue(encoder.encode("5678"));
      },
      cancel,
    });
    const request = new EdgeRequest("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);

    await expect(
      readLimitedTextBody(request as unknown as Request, 6),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized declared length before reading the body", async () => {
    const request = new EdgeRequest("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "101" },
      body: "{}",
    });

    await expect(
      readLimitedTextBody(request as unknown as Request, 100),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
