import { readStreamChunkWithAbort } from "@/lib/api/read-stream-chunk-with-abort";

describe("readStreamChunkWithAbort", () => {
  it("removes its abort listener after a successful read", async () => {
    const abortController = new AbortController();
    const removeListener = jest.spyOn(
      abortController.signal,
      "removeEventListener",
    );
    const reader = {
      read: jest.fn().mockResolvedValue({ done: false, value: "chunk" }),
    };

    await expect(
      readStreamChunkWithAbort(reader, abortController.signal),
    ).resolves.toEqual({ done: false, value: "chunk" });

    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });

  it("rejects promptly on abort and removes its listener", async () => {
    const abortController = new AbortController();
    const removeListener = jest.spyOn(
      abortController.signal,
      "removeEventListener",
    );
    const reader = {
      read: jest.fn(
        () => new Promise<ReadableStreamReadResult<string>>(() => {}),
      ),
    };

    const readPromise = readStreamChunkWithAbort(
      reader,
      abortController.signal,
    );
    abortController.abort();

    await expect(readPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });

  it("does not start a read when the signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const reader = { read: jest.fn() };

    await expect(
      readStreamChunkWithAbort(reader, abortController.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.read).not.toHaveBeenCalled();
  });
});
