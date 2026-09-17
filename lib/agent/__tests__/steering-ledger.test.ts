import type { ModelMessage } from "ai";
import {
  createCompletedStepCheckpoint,
  restoreCompletedStepCheckpoint,
} from "../checkpoint";
import {
  buildSteeredHistory,
  type SteeringInsertion,
} from "../steering-ledger";

const initial: ModelMessage[] = [{ role: "user", content: "Build the page" }];
const completed: ModelMessage[] = [
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Inspect first",
        providerOptions: { test: { signature: "signed-reasoning" } },
      },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "index.html" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: { type: "text", value: "original bytes" },
      },
    ],
  },
];
const entry = (
  changes: Partial<SteeringInsertion> = {},
): SteeringInsertion => ({
  id: "input-a",
  sequence: 1,
  afterResponseMessageCount: 2,
  text: "Use blue",
  ...changes,
});
const build = (
  insertions: readonly SteeringInsertion[],
  responseMessages = completed,
) =>
  buildSteeredHistory({
    initialMessages: initial,
    responseMessages,
    insertions,
  });

it("preserves the original history and message references when there is no steering", () => {
  const result = build([]);
  expect(result).toEqual({
    messages: [...initial, ...completed],
    insertedIds: [],
    includedThroughSequence: 0,
  });
  expect(result.messages[1]).toBe(completed[0]);
});

it("inserts at closed cumulative response offsets for every request and checkpoint", () => {
  const first = entry();
  const second = entry({
    id: "input-b",
    sequence: 2,
    afterResponseMessageCount: 3,
    text: "Keep the footer",
  });
  const tail: ModelMessage[] = [
    ...completed,
    { role: "assistant", content: "Blue page ready" },
  ];
  const request = build([first, second], tail);
  const checkpoint = createCompletedStepCheckpoint({
    initialMessages: request.messages,
    responseMessages: [],
    stepIndex: 2,
    finishReason: "tool-calls",
  });
  expect(restoreCompletedStepCheckpoint(checkpoint).messages).toEqual(
    request.messages,
  );
  expect(request.messages).toEqual([
    ...initial,
    ...completed,
    { role: "user", content: "Use blue" },
    tail[2],
    { role: "user", content: "Keep the footer" },
  ]);
  expect(request.insertedIds).toEqual(["input-a", "input-b"]);
  expect(request.includedThroughSequence).toBe(2);
  expect(build([first]).messages).toEqual([
    ...initial,
    ...completed,
    { role: "user", content: "Use blue" },
  ]);
});

it("orders same-boundary inputs by server sequence, independently of query order", () => {
  expect(
    build([
      entry({ id: "b", sequence: 2, text: "Then green" }),
      entry(),
    ]).messages.slice(-2),
  ).toEqual([
    { role: "user", content: "Use blue" },
    { role: "user", content: "Then green" },
  ]);
});

it("accepts an exact retried receipt once without mutating inputs", () => {
  const first = Object.freeze(entry());
  const insertions = Object.freeze([first, Object.freeze({ ...first })]);
  const result = build(insertions);
  expect(result.insertedIds).toEqual(["input-a"]);
  expect(
    result.messages.filter((message) => message.role === "user"),
  ).toHaveLength(2);
  expect(insertions).toHaveLength(2);
});

it.each([
  { text: "Altered" },
  { sequence: 2 },
  { afterResponseMessageCount: 0 },
])("rejects a conflicting retry for the same ID: %j", (changes) => {
  expect(() => build([entry(), entry(changes)])).toThrow(/conflict/i);
});

it("rejects two different input IDs with the same sequence", () => {
  expect(() => build([entry(), entry({ id: "different" })])).toThrow(
    /sequence/i,
  );
});

it("rejects offsets that move backwards in sequence order", () => {
  expect(() =>
    build([
      entry(),
      entry({ id: "b", sequence: 2, afterResponseMessageCount: 0 }),
    ]),
  ).toThrow(/order/i);
});

it.each([-1, 1.5, Number.NaN, 3])(
  "rejects invalid response offset %s",
  (offset) => {
    expect(() => build([entry({ afterResponseMessageCount: offset })])).toThrow(
      /offset/i,
    );
  },
);

it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
  "rejects invalid sequence %s",
  (sequence) => {
    expect(() => build([entry({ sequence })])).toThrow(/sequence/i);
  },
);

it("rejects empty identity or blank instruction rather than silently dropping it", () => {
  expect(() => build([entry({ id: " " })])).toThrow(/identity/i);
  expect(() => build([entry({ text: " \n " })])).toThrow(/text/i);
});

it("can insert before the first generated response without changing user text bytes", () => {
  const text = "  Keep café 🌱\nexactly\n";
  expect(
    build([entry({ afterResponseMessageCount: 0, text })]).messages,
  ).toEqual([...initial, { role: "user", content: text }, ...completed]);
});

it("rejects insertion between a tool call and its result", () => {
  expect(() => build([entry({ afterResponseMessageCount: 1 })])).toThrow(
    /unresolved/i,
  );
});

it("rejects insertion while any parallel tool call is unresolved", () => {
  const parallel: ModelMessage[] = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "read", input: {} },
        { type: "tool-call", toolCallId: "b", toolName: "read", input: {} },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "a",
          toolName: "read",
          output: { type: "text", value: "a" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "b",
          toolName: "read",
          output: { type: "text", value: "b" },
        },
      ],
    },
  ];
  expect(() => build([entry()], parallel)).toThrow(/unresolved/i);
  expect(
    build([entry({ afterResponseMessageCount: 3 })], parallel).messages.slice(
      -1,
    ),
  ).toEqual([{ role: "user", content: "Use blue" }]);
});

it("rejects unresolved, orphaned, duplicate or mismatched tool history", () => {
  expect(() => build([], [completed[0]])).toThrow(/unresolved/i);
  expect(() => build([], [completed[1]])).toThrow(/orphan|mismatch/i);
  expect(() => build([], [...completed, ...completed])).toThrow(/duplicate/i);
  const mismatched: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "write_file",
        output: { type: "text", value: "wrong" },
      },
    ],
  };
  expect(() => build([], [completed[0], mismatched])).toThrow(/mismatch/i);
});

it("does not allow a generated tail to smuggle another user turn", () => {
  expect(() => build([], [{ role: "user", content: "not a receipt" }])).toThrow(
    /generated/i,
  );
});

it("does not rewrite provider metadata or binary input while adding steering", () => {
  const bytes = new Uint8Array([0, 255, 32]);
  const prefix: ModelMessage[] = [
    { role: "user", content: [{ type: "image", image: bytes }] },
  ];
  const result = buildSteeredHistory({
    initialMessages: prefix,
    responseMessages: completed,
    insertions: [entry()],
  });
  expect(result.messages).toEqual([
    ...prefix,
    ...completed,
    { role: "user", content: "Use blue" },
  ]);
  expect(result.messages[0]).toBe(prefix[0]);
  expect(result.messages[1]).toBe(completed[0]);
  expect(bytes).toEqual(new Uint8Array([0, 255, 32]));
});

it("resumes from the acknowledged prefix without inserting old receipts again", () => {
  const restoredPrefix = [
    ...initial,
    ...completed,
    { role: "user" as const, content: "Use blue" },
  ];
  const result = buildSteeredHistory({
    initialMessages: restoredPrefix,
    responseMessages: [],
    includedThroughSequence: 1,
    insertions: [
      entry(),
      entry({
        id: "b",
        sequence: 2,
        afterResponseMessageCount: 0,
        text: "Continue",
      }),
    ],
  });
  expect(result.messages).toEqual([
    ...restoredPrefix,
    { role: "user", content: "Continue" },
  ]);
  expect(result.insertedIds).toEqual(["b"]);
  expect(result.includedThroughSequence).toBe(2);
});

it("rejects invalid acknowledged watermark and an unresolved original prefix", () => {
  expect(() =>
    buildSteeredHistory({
      initialMessages: initial,
      responseMessages: [],
      insertions: [],
      includedThroughSequence: -1,
    }),
  ).toThrow(/watermark/i);
  expect(() =>
    buildSteeredHistory({
      initialMessages: [completed[0]],
      responseMessages: [],
      insertions: [entry({ afterResponseMessageCount: 0 })],
    }),
  ).toThrow(/unresolved/i);
});

it.each(["text", "reasoning"] as const)(
  "rejects a new assistant %s array while an earlier tool call is unresolved",
  (type) => {
    const continuation: ModelMessage = {
      role: "assistant",
      content: [{ type, text: "Continue before the result" }],
    };
    expect(() =>
      build(
        [entry({ afterResponseMessageCount: 3 })],
        [completed[0], continuation, completed[1]],
      ),
    ).toThrow(/unresolved/i);
  },
);

it("preserves a provider-executed call and result closed within the same assistant message", () => {
  const providerMessage: ModelMessage = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "provider-call",
        toolName: "search",
        input: { query: "fixtures" },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "provider-call",
        toolName: "search",
        output: { type: "text", value: "Found fixture" },
      },
      { type: "text", text: "Provider search completed" },
    ],
  };
  const result = build(
    [entry({ afterResponseMessageCount: 1 })],
    [providerMessage],
  );
  expect(result.messages).toEqual([
    ...initial,
    providerMessage,
    { role: "user", content: "Use blue" },
  ]);
  expect(result.messages[1]).toBe(providerMessage);
});
