import {
  isRetryableTerminalStartupError,
  terminalStartupRetryDelayMs,
} from "../interactive-terminal-retry";

describe("interactive terminal startup retry policy", () => {
  it("retries explicit transient responses and browser network failures", () => {
    expect(isRetryableTerminalStartupError({ retryable: true })).toBe(true);
    expect(isRetryableTerminalStartupError(new TypeError("fetch failed"))).toBe(
      true,
    );
    expect(
      isRetryableTerminalStartupError(
        new DOMException("request timed out", "TimeoutError"),
      ),
    ).toBe(true);
  });

  it("does not retry invalid service responses or explicit fatal errors", () => {
    expect(isRetryableTerminalStartupError({ retryable: false })).toBe(false);
    expect(isRetryableTerminalStartupError(new Error("invalid session"))).toBe(
      false,
    );
  });

  it("uses capped exponential backoff", () => {
    expect([1, 2, 3, 4, 5, 20].map(terminalStartupRetryDelayMs)).toEqual([
      350, 700, 1400, 2800, 2800, 2800,
    ]);
  });
});
