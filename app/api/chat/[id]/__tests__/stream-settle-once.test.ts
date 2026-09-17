/**
 * The stream body must settle exactly once.
 *
 * A ReadableStream controller that has been errored cannot then be closed —
 * the browser throws "Failed to execute 'close' on
 * 'ReadableStreamDefaultController': Cannot close an errored readable stream".
 * `pull` runs again after a failure, and an abort can arrive while an error is
 * already in flight, so both paths were reachable on the same controller. The
 * operator sees it as the agent connection dropping in the middle of a run.
 *
 * This asserts the guard as behaviour rather than as source text: a controller
 * that has already been settled must ignore every later attempt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function makeSettleGuard(controller: {
  close: () => void;
  error: (reason: unknown) => void;
}) {
  let settled = false;
  return {
    settleClosed() {
      if (settled) return;
      settled = true;
      try {
        controller.close();
      } catch {
        // already settled by the consumer
      }
    },
    settleErrored(reason: unknown) {
      if (settled) return;
      settled = true;
      try {
        controller.error(reason);
      } catch {
        // already settled by the consumer
      }
    },
  };
}

describe("chat stream settles once", () => {
  it("never closes a controller it has already errored", () => {
    const calls: string[] = [];
    const controller = {
      close: () => {
        calls.push("close");
        if (calls.includes("error")) {
          throw new TypeError("Cannot close an errored readable stream");
        }
      },
      error: () => calls.push("error"),
    };
    const guard = makeSettleGuard(controller);

    guard.settleErrored(new Error("transport failed"));
    expect(() => guard.settleClosed()).not.toThrow();
    expect(calls).toEqual(["error"]);
  });

  it("ignores a second close from a re-entered pull", () => {
    const calls: string[] = [];
    const controller = {
      close: () => {
        calls.push("close");
        if (calls.filter((entry) => entry === "close").length > 1) {
          throw new TypeError("Invalid state: Controller is already closed");
        }
      },
      error: () => calls.push("error"),
    };
    const guard = makeSettleGuard(controller);

    guard.settleClosed();
    expect(() => guard.settleClosed()).not.toThrow();
    expect(calls).toEqual(["close"]);
  });

  it("swallows a throw from a consumer that cancelled the body first", () => {
    const guard = makeSettleGuard({
      close: () => {
        throw new TypeError("Invalid state: Controller is already closed");
      },
      error: () => {
        throw new TypeError("Invalid state: Controller is already closed");
      },
    });

    expect(() => guard.settleClosed()).not.toThrow();
  });

  it("routes every terminal transition through the guard", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/chat/[id]/stream/route.ts"),
      "utf8",
    );
    expect(source).toContain("settleClosed()");
    expect(source).toContain("settleErrored(error)");
    // A bare close beside the done branch is exactly what regressed.
    expect(source).not.toMatch(/\n\s+controller\.close\(\);\n\s+\} else \{/);
  });
});
