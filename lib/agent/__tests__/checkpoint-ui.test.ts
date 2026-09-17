import { convertToModelMessages, type ModelMessage } from "ai";
import { projectCheckpointAssistantMessage } from "../checkpoint-ui";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const user: ModelMessage = {
  role: "user",
  content: "Inspect and fix this source.",
};
const call = (id = "read-1", name = "file") => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName: name,
  input: { action: "read", path: "/src/app.ts" },
});
const result = (id = "read-1", name = "file") => ({
  type: "tool-result" as const,
  toolCallId: id,
  toolName: name,
  output: { type: "json" as const, value: { content: "export const x = 1" } },
});
const project = (
  messages: ModelMessage[],
  messageId = "recovered-request-step-2",
) => projectCheckpointAssistantMessage({ messages, messageId });

describe("completed checkpoint UI projection", () => {
  it("round-trips only the current user turn's multi-step text, reasoning and tool/error history", async () => {
    const tail: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Check the source first.",
            providerOptions: { anthropic: { signature: "provider-signature" } },
          },
          {
            type: "text",
            text: "Reading the file.",
            providerOptions: { provider: { marker: "text-metadata" } },
          },
          call(),
        ],
      },
      { role: "tool", content: [result()] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now verify." },
          { ...call("check-2", "verify_app"), input: { command: "npm test" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "check-2",
            toolName: "verify_app",
            output: { type: "error-text", value: "Missing test script" },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The source has no test script." }],
      },
    ];
    const history: ModelMessage[] = [
      { role: "system", content: "Agent instructions" },
      { role: "user", content: "An older request" },
      { role: "assistant", content: "Older answer" },
      user,
      ...tail,
    ];
    const before = clone(history);
    const projected = project(history)!;
    expect(projected.id).toBe("recovered-request-step-2");
    expect(projected.role).toBe("assistant");
    expect(
      projected.parts.filter((part) => part.type === "step-start"),
    ).toHaveLength(3);
    expect(
      projected.parts.find((part) => part.type === "tool-verify_app"),
    ).toMatchObject({
      toolCallId: "check-2",
      state: "output-error",
      input: { command: "npm test" },
      errorText: "Missing test script",
    });
    expect(clone(await convertToModelMessages([projected]))).toEqual(tail);
    expect(history).toEqual(before);
    expect(JSON.stringify(projected)).not.toContain("Older answer");
  });

  it("preserves parallel call IDs, inputs, text/json outputs and shared tool metadata", async () => {
    const metadata = { provider: { cacheKey: "same" } };
    const tail: ModelMessage[] = [
      {
        role: "assistant",
        content: [call("a"), { ...call("b"), providerOptions: metadata }],
      },
      {
        role: "tool",
        content: [
          { ...result("a"), output: { type: "text", value: "first result" } },
          { ...result("b"), providerOptions: metadata },
        ],
      },
    ];
    expect(
      clone(await convertToModelMessages([project([user, ...tail])!])),
    ).toEqual(tail);
  });

  it("normalizes plain assistant text into a completed text part and keeps the chosen identity stable", () => {
    const history: ModelMessage[] = [
      user,
      { role: "assistant", content: "Recovered answer" },
    ];
    expect(project(history, "stable-id")).toEqual({
      id: "stable-id",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Recovered answer", state: "done" },
      ],
    });
    expect(project(history, "stable-id")).toEqual(
      project(history, "stable-id"),
    );
  });

  it.each(
    [
      [],
      [user],
      [{ role: "assistant", content: "No current user anchor" }],
      [user, { role: "assistant", content: [call()] }],
      [user, { role: "tool", content: [result()] }],
      [
        user,
        { role: "assistant", content: [call(), call()] },
        { role: "tool", content: [result()] },
      ],
      [
        user,
        { role: "assistant", content: [call()] },
        { role: "tool", content: [result("read-1", "wrong-tool")] },
      ],
    ].map((messages) => ({ messages })),
  )(
    "returns null for absent or incomplete/unpaired current-turn evidence (%#)",
    ({ messages }) => {
      expect(project(messages as ModelMessage[])).toBeNull();
    },
  );

  it.each([
    { type: "content", value: [{ type: "text", text: "multimodal" }] },
    { type: "error-json", value: { reason: "structured error" } },
    { type: "execution-denied", reason: "denied" },
    {
      type: "json",
      value: "JSON string cannot stay JSON through default SDK conversion",
    },
    {
      type: "text",
      value: "value",
      providerOptions: { provider: { special: true } },
    },
  ])(
    "fails closed for output formats the SDK UI converter would change (%#)",
    (output) => {
      expect(
        project([
          user,
          { role: "assistant", content: [call()] },
          { role: "tool", content: [{ ...result(), output } as never] },
        ]),
      ).toBeNull();
    },
  );

  it("fails closed when local result metadata differs from call metadata", () => {
    expect(
      project([
        user,
        { role: "assistant", content: [call()] },
        {
          role: "tool",
          content: [
            {
              ...result(),
              providerOptions: { provider: { resultOnly: true } },
            },
          ],
        },
      ]),
    ).toBeNull();
  });

  it("does not include earlier completed runs when a new user turn has begun", () => {
    expect(
      project([
        user,
        { role: "assistant", content: [call()] },
        { role: "tool", content: [result()] },
        { role: "user", content: "New request" },
      ]),
    ).toBeNull();
  });
});
