import { agentWorkerIncomingMessages } from "../agent-worker-messages";
const messages = [
  {
    id: "user-1",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hello" }],
  },
];
it("retains ephemeral input because it has no persisted transcript", () => {
  expect(agentWorkerIncomingMessages(true, messages)).toEqual(messages);
});
it("does not append a second copy of a persisted user message", () => {
  expect(agentWorkerIncomingMessages(false, messages)).toEqual([]);
  expect(agentWorkerIncomingMessages(undefined, messages)).toEqual([]);
});
