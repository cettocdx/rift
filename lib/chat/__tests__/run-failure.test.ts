import { describeRunFailure } from "../run-failure";

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
