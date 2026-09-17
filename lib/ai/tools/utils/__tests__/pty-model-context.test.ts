/** @jest-environment node */
import { preservePtyModelContext } from "../pty-model-context";
import { projectPtyOutput, ptyModelOutput } from "../pty-model-output";

function sandbox() {
  const files = new Map<string, string>();
  const value = {
    commands: { run: jest.fn(async () => undefined) },
    files: {
      write: jest.fn(async (path: string, text: string) => {
        files.set(path, text);
      }),
    },
  };
  return { files, value };
}
const snapshot = {
  raw: "raw ansi",
  cleaned: "old evidence\n".repeat(1000),
  screen: "current prompt>",
};

test("simultaneous polls share one confirmed receipt with exact recoverable text", async () => {
  const { value, files } = sandbox();
  const session = {};
  const getSandbox = jest.fn(async () => value as any);
  const [a, b] = await Promise.all([
    preservePtyModelContext(session, snapshot, getSandbox),
    preservePtyModelContext(session, snapshot, getSandbox),
  ]);
  expect(a).toEqual(b);
  expect(value.files.write).toHaveBeenCalledTimes(1);
  expect(files.get(a!.scrollback.path)).toBe(snapshot.cleaned);
  expect(a!.scrollback.characters).toBe(snapshot.cleaned.length);
});

test("small output and unavailable screen parser do not cause artifact I/O or lose evidence", async () => {
  const getSandbox = jest.fn();
  expect(
    await preservePtyModelContext(
      {},
      { ...snapshot, cleaned: "small" },
      getSandbox,
    ),
  ).toBeUndefined();
  expect(
    await preservePtyModelContext(
      {},
      { ...snapshot, screen: undefined },
      getSandbox,
    ),
  ).toBeUndefined();
  expect(getSandbox).not.toHaveBeenCalled();
});

test("model projection is immutable, keeps statuses and does not remove legacy evidence without a receipt", () => {
  const original = {
    result: {
      output: "delta",
      session: "session",
      exited: { exitCode: 7 },
      bufferTruncated: true,
      sessionSnapshot: snapshot.cleaned,
      rawSnapshot: snapshot.raw,
    },
  };
  const legacy = projectPtyOutput(original) as any;
  expect(legacy.result.sessionSnapshot).toBe(snapshot.cleaned);
  expect(legacy.result.rawSnapshot).toBeUndefined();
  expect(original.result.rawSnapshot).toBe(snapshot.raw);
  const context = {
    screen: "prompt",
    scrollback: {
      path: "/tmp/terminal_full_output/fixture.txt",
      characters: snapshot.cleaned.length,
      scope: "retained PTY snapshot",
    },
  };
  const current = { result: { ...original.result, modelContext: context } };
  const projected = projectPtyOutput(current) as any;
  expect(projected.result).toEqual({
    output: "delta",
    session: "session",
    exited: { exitCode: 7 },
    bufferTruncated: true,
    ...context,
  });
  expect(current.result.sessionSnapshot).toBe(snapshot.cleaned);
  expect(projectPtyOutput(current, true)).toEqual(legacy);
});

test.each([
  null,
  "error",
  { result: { output: "ordinary", exitCode: 0 } },
  { error: "missing" },
])("non-PTY/errors preserve their payload: %j", (output) => {
  expect(ptyModelOutput(output)).toEqual({
    type: "text",
    value:
      output !== null && typeof output === "object"
        ? JSON.stringify(output)
        : String(output ?? ""),
  });
});

test("an unresponsive artifact transport cannot indefinitely delay a terminal result", async () => {
  jest.useFakeTimers();
  try {
    let finished = false;
    const result = preservePtyModelContext(
      {},
      snapshot,
      () => new Promise(() => {}),
    ).then((value) => {
      finished = true;
      return value;
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(finished).toBe(true);
    expect(await result).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("late successful saves after deadline never advertise a receipt and are safe to retry", async () => {
  jest.useFakeTimers();
  try {
    const { value } = sandbox();
    let complete!: () => void;
    value.files.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const session = {};
    const getSandbox = async () => value as any;
    const pending = preservePtyModelContext(session, snapshot, getSandbox);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeUndefined();
    complete();
    await jest.advanceTimersByTimeAsync(0);
    const retry = await preservePtyModelContext(session, snapshot, getSandbox);
    expect(retry!.scrollback.path).toBe(value.files.write.mock.calls[0][0]);
    expect(value.files.write).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("successful and failed saves clear their deadline timers immediately", async () => {
  jest.useFakeTimers();
  try {
    const { value } = sandbox();
    expect(
      await preservePtyModelContext({}, snapshot, async () => value as any),
    ).toBeDefined();
    expect(jest.getTimerCount()).toBe(0);
    expect(
      await preservePtyModelContext({}, snapshot, async () => {
        throw new Error("sandbox unavailable");
      }),
    ).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
