import type { ModelMessage } from "ai";
import {
  createCompletedStepCheckpoint,
  restoreCompletedStepCheckpoint,
} from "../checkpoint";

const initial: ModelMessage[] = [{ role: "user", content: "Edit the file" }];
const completed: ModelMessage[] = [
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Inspect first",
        providerOptions: { test: { signature: "sig" } },
      },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "edit",
        input: { path: "a.ts" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "edit",
        output: { type: "json", value: { changed: true } },
      },
    ],
  },
];
const checkpoint = (
  responseMessages = completed,
  finishReason = "tool-calls",
) =>
  createCompletedStepCheckpoint({
    initialMessages: initial,
    responseMessages,
    stepIndex: 1,
    finishReason,
  });

describe("completed model step checkpoint", () => {
  it("preserves canonical tool inputs, results and provider reasoning metadata", () => {
    expect(restoreCompletedStepCheckpoint(checkpoint())).toMatchObject({
      resumeAllowed: true,
      reason: "ready",
      messages: [...initial, ...completed],
    });
  });

  it("treats SDK response.messages as cumulative instead of duplicating prior tools", () => {
    const first = checkpoint();
    const second = createCompletedStepCheckpoint({
      initialMessages: initial,
      responseMessages: [...completed, { role: "assistant", content: "Done" }],
      stepIndex: 2,
      finishReason: "stop",
    });
    expect(restoreCompletedStepCheckpoint(first).messages).toHaveLength(3);
    expect(restoreCompletedStepCheckpoint(second)).toMatchObject({
      resumeAllowed: false,
      reason: "already-finished",
    });
    expect(restoreCompletedStepCheckpoint(second).messages).toHaveLength(4);
  });

  it("does not let later input mutation corrupt an already completed checkpoint", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "Original" },
    ];
    const saved = checkpoint(messages, "stop");
    messages[0].content = "Changed";
    expect(restoreCompletedStepCheckpoint(saved).messages.at(-1)?.content).toBe(
      "Original",
    );
  });

  it("refuses to snapshot unresolved, orphaned, or duplicated tool execution", () => {
    expect(() => checkpoint([completed[0]])).toThrow(/unresolved/i);
    expect(() => checkpoint([completed[1]])).toThrow(/orphan/i);
    expect(() => checkpoint([...completed, ...completed])).toThrow(
      /duplicate/i,
    );
  });

  it("rejects unresolved tools crossing a plain-text user or assistant boundary", () => {
    for (const role of ["user", "assistant"] as const) {
      const saved = {
        ...checkpoint(),
        messagesJson: JSON.stringify([
          ...initial,
          completed[0],
          { role, content: "New instruction" },
          completed[1],
        ]),
      };
      expect(() => restoreCompletedStepCheckpoint(saved)).toThrow(
        /unresolved/i,
      );
    }
  });

  it.each(["text", "reasoning"] as const)(
    "rejects an assistant %s array crossing an unfinished tool batch",
    (type) => {
      const response: ModelMessage[] = [
        completed[0],
        { role: "assistant", content: [{ type, text: "Next step" }] },
        completed[1],
      ];
      expect(() => checkpoint(response)).toThrow(/unresolved/i);
      expect(() =>
        restoreCompletedStepCheckpoint({
          ...checkpoint(),
          messagesJson: JSON.stringify([...initial, ...response]),
        }),
      ).toThrow(/unresolved/i);
    },
  );

  it("keeps provider-executed calls and results in the same assistant message", () => {
    const response: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "provider-1",
            toolName: "search",
            input: {},
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "provider-1",
            toolName: "search",
            output: { type: "text", value: "Found" },
          },
        ],
      },
    ];
    expect(
      restoreCompletedStepCheckpoint(checkpoint(response)).messages,
    ).toEqual([...initial, ...response]);
  });

  it("accepts a completed tool failure without converting it to another tool call", () => {
    const failed: ModelMessage[] = [
      completed[0],
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "edit",
            output: { type: "error-text", value: "Permission denied" },
          },
        ],
      },
    ];
    expect(restoreCompletedStepCheckpoint(checkpoint(failed)).messages).toEqual(
      [...initial, ...failed],
    );
  });

  it("blocks automatic resume when any newer step may have performed side effects", () => {
    expect(
      restoreCompletedStepCheckpoint(checkpoint(), { inFlightStepIndex: 2 }),
    ).toMatchObject({ resumeAllowed: false, reason: "in-flight-step" });
    expect(
      restoreCompletedStepCheckpoint(checkpoint(), { inFlightStepIndex: 1 })
        .resumeAllowed,
    ).toBe(true);
  });

  it("does not automatically continue a length/error interrupted finish", () => {
    expect(
      restoreCompletedStepCheckpoint(
        checkpoint([{ role: "assistant", content: "Partial" }], "length"),
      ),
    ).toMatchObject({ resumeAllowed: false, reason: "non-continuable-finish" });
  });

  it("serializes binary attachments and URLs as valid model inputs", () => {
    const saved = createCompletedStepCheckpoint({
      initialMessages: [
        {
          role: "user",
          content: [
            { type: "image", image: new Uint8Array([1, 2, 3]) },
            { type: "image", image: new URL("https://example.com/a.png") },
          ],
        },
      ],
      responseMessages: [{ role: "assistant", content: "Done" }],
      stepIndex: 1,
      finishReason: "stop",
    });
    expect(restoreCompletedStepCheckpoint(saved).messages[0].content).toEqual([
      { type: "image", image: "AQID" },
      { type: "image", image: "https://example.com/a.png" },
    ]);
  });

  it("rejects malformed or oversized stored history instead of silently dropping content", () => {
    expect(() =>
      restoreCompletedStepCheckpoint({ ...checkpoint(), messagesJson: "{}" }),
    ).toThrow();
    expect(() =>
      restoreCompletedStepCheckpoint({ ...checkpoint(), version: 2 } as never),
    ).toThrow();
    expect(() =>
      checkpoint([{ role: "assistant", content: "x".repeat(800_000) }], "stop"),
    ).toThrow(/large/i);
    expect(() =>
      checkpoint([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "wrong",
              output: { type: "text", value: "Done" },
            },
          ],
        },
      ]),
    ).toThrow();
  });
});
