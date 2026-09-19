import {
  describeRunFailure,
  PERSISTED_SANDBOX_FAILURE_MESSAGE,
  PERSISTED_MODEL_FAILURE_MESSAGE,
  PERSISTED_RUN_FAILURE_MESSAGE,
} from "../run-failure";

it("explains local runner failure without claiming an internet interruption", () => {
  const message = describeRunFailure(
    new Error("The selected local runner is offline or unavailable."),
  );
  expect(message).toContain("selected local computer");
  expect(message).toContain("sign in with the same account");
  expect(message).toContain("reconnect automatically");
  expect(message).toContain("no cloud fallback was started");
});
it("does not persist raw unknown errors or credentials", () => {
  expect(describeRunFailure(new Error("private-secret-value"))).not.toContain(
    "private-secret-value",
  );
});
it("distinguishes a service timeout", () => {
  expect(describeRunFailure(new Error("Request timed out"))).toContain(
    "timed out",
  );
});
it("surfaces a coding-sandbox boot failure as actionable, retryable copy", () => {
  expect(
    describeRunFailure(new Error("Failed creating persistent sandbox: boom")),
  ).toBe(PERSISTED_SANDBOX_FAILURE_MESSAGE);
  expect(
    describeRunFailure(new Error("Sandbox authentication failed")),
  ).toBe(PERSISTED_SANDBOX_FAILURE_MESSAGE);
});
it("classifies a provider/model rejection by transport status", () => {
  expect(describeRunFailure({ statusCode: 404 })).toBe(
    PERSISTED_MODEL_FAILURE_MESSAGE,
  );
  expect(
    describeRunFailure(
      new Error("No endpoints found that support tool use"),
    ),
  ).toBe(PERSISTED_MODEL_FAILURE_MESSAGE);
});
it("does not leak raw provider detail for classified model errors", () => {
  const message = describeRunFailure({
    statusCode: 400,
    data: { error: { message: "leaky-upstream-secret" } },
  });
  expect(message).toBe(PERSISTED_MODEL_FAILURE_MESSAGE);
  expect(message).not.toContain("leaky-upstream-secret");
});
it("falls back to the generic failure for unclassified errors", () => {
  expect(describeRunFailure(new Error("something odd"))).toBe(
    PERSISTED_RUN_FAILURE_MESSAGE,
  );
});
