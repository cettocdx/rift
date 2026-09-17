import { describeRunFailure } from "../run-failure";
import { needsWorkReconciliation } from "../recovery-request";
import {
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
  AGENT_START_TIMEOUT_MESSAGE,
} from "../interrupted-response";

it.each([
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
])("preserves saved work after %s", (message) => {
  expect(needsWorkReconciliation(new Error(message))).toBe(true);
  expect(
    needsWorkReconciliation(new Error("transport", { cause: message })),
  ).toBe(true);
});
it.each([
  AGENT_START_TIMEOUT_MESSAGE,
  "Insufficient credits",
  "The selected computer is disconnected",
])("does not infer previously executed work from %s", (message) => {
  expect(needsWorkReconciliation(new Error(message))).toBe(false);
});
it("has no recovery action without an error", () => {
  expect(needsWorkReconciliation(undefined)).toBe(false);
});

it.each([new Error("worker process exited"), new Error("timed out")])(
  "reconciles the actual durable failure serialization: %s",
  (error) => {
    expect(needsWorkReconciliation(new Error(describeRunFailure(error)))).toBe(
      true,
    );
  },
);
