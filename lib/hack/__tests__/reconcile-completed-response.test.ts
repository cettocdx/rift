import { reconcileCompletedResponses } from "../reconcile-completed-response";

const partial = {
  id: "answer-1",
  role: "assistant",
  parts: [
    { type: "text", text: "Checking the local test file." },
    { type: "tool-read_file" },
  ],
};
const final = {
  ...partial,
  parts: [...partial.parts, { type: "text", text: "The file is valid." }],
};

it("recovers a saved final answer when the local reader ended at a tool", () => {
  expect(reconcileCompletedResponses([partial], [final], true)).toEqual([
    final,
  ]);
});
it("does not replace live output or a completed local answer", () => {
  const live = [partial];
  expect(reconcileCompletedResponses(live, [final], false)).toBe(live);
  const finished = [final];
  expect(
    reconcileCompletedResponses(
      finished,
      [{ ...final, parts: [{ type: "text", text: "Older" }] }],
      true,
    ),
  ).toBe(finished);
});
it("preserves a new user message missing from the database snapshot", () => {
  const user = {
    id: "new-user",
    role: "user",
    parts: [{ type: "text", text: "Next task" }],
  };
  expect(reconcileCompletedResponses([partial, user], [final], true)).toEqual([
    final,
    user,
  ]);
});
it("does not promote a different message, tool output or earlier commentary to a final answer", () => {
  const local = [partial];
  expect(
    reconcileCompletedResponses(local, [{ ...final, id: "other" }], true),
  ).toBe(local);
  expect(reconcileCompletedResponses(local, [partial], true)).toBe(local);
});
it("does not match messages without stable identities", () => {
  const local = [{ ...partial, id: undefined }];
  expect(
    reconcileCompletedResponses(local, [{ ...final, id: undefined }], true),
  ).toBe(local);
});
