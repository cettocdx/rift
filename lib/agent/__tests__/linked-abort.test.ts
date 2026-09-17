import { linkAgentAbortSignal } from "../linked-abort";

it("retains cancellation that happened while worker setup was awaiting", () => {
  const trigger = new AbortController();
  const reason = new Error("Stopped during setup");
  trigger.abort(reason);
  const { controller, dispose } = linkAgentAbortSignal(trigger.signal);
  expect(controller.signal.aborted).toBe(true);
  expect(controller.signal.reason).toBe(reason);
  dispose();
});

it("forwards a later cancellation and releases its listener on completion", () => {
  const trigger = new AbortController();
  const first = linkAgentAbortSignal(trigger.signal);
  const completed = linkAgentAbortSignal(trigger.signal);
  completed.dispose();
  trigger.abort("stop");
  expect(first.controller.signal.aborted).toBe(true);
  expect(first.controller.signal.reason).toBe("stop");
  expect(completed.controller.signal.aborted).toBe(false);
  first.dispose();
});
