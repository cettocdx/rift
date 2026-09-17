import { conversationStatus } from "../conversation-status";
const now = 10_000_000;
const chat = { id: "chat-1" };
const run = {
  id: "trigger",
  chat_id: chat.id,
  started_at: now - 10_000,
  status: "running",
};
describe("conversation status", () => {
  it.each([undefined, now])(
    "shows a completed warning as its own outcome (ended=%s)",
    (ended_at) => {
      const warning = { ...run, status: "completed_with_warnings", ended_at };
      expect(
        conversationStatus(
          { ...chat, active_trigger_run_id: run.id },
          warning,
          false,
          now,
        ),
      ).toBe("warning");
      expect(conversationStatus(chat, warning, true, now)).toBe("warning");
      expect(
        conversationStatus(
          { ...chat, active_trigger_run_id: "replacement" },
          warning,
          false,
          now,
        ),
      ).toBe("running");
    },
  );
  it.each(["completed", "cancelled"])(
    "does not turn known %s into a connection warning while cleanup catches up",
    (status) => {
      const ended = { ...run, status, ended_at: now };
      const retained = { ...chat, active_trigger_run_id: run.id };
      expect(conversationStatus(retained, ended, false, now)).toBeUndefined();
      expect(conversationStatus(retained, ended, true, now)).toBe("draft");
      expect(
        conversationStatus(
          retained,
          { ...ended, ended_at: undefined },
          false,
          now,
        ),
      ).toBeUndefined();
    },
  );
  it.each(["completed", "failed", "waiting_for_approval"])(
    "does not apply previous %s to a newly active run",
    (status) => {
      expect(
        conversationStatus(
          { ...chat, active_trigger_run_id: "replacement" },
          {
            ...run,
            status,
            ...(status === "waiting_for_approval" ? {} : { ended_at: now }),
          },
          false,
          now,
        ),
      ).toBe("running");
    },
  );
  it("ignores another chat's approval state", () => {
    expect(
      conversationStatus(
        chat,
        { ...run, chat_id: "other", status: "waiting_for_approval" },
        false,
        now,
      ),
    ).toBeUndefined();
  });
  it("does not assign a previous result to an opaque legacy stream identifier", () => {
    const completed = { ...run, status: "completed", ended_at: now };
    expect(
      conversationStatus(
        { ...chat, active_stream_id: "stream" },
        completed,
        false,
        now,
      ),
    ).toBe("running");
  });
  it("prioritizes an approval over an active stream or draft", () => {
    expect(
      conversationStatus(
        { ...chat, active_trigger_run_id: run.id },
        { ...run, status: "waiting_for_approval" },
        true,
        now,
      ),
    ).toBe("waiting");
  });
  it("does not show an ended run or stale stream as running", () => {
    expect(
      conversationStatus(
        { ...chat, active_trigger_run_id: "trigger" },
        { ...run, ended_at: now, status: "failed" },
        false,
        now,
      ),
    ).toBe("failed");
    expect(
      conversationStatus(
        { ...chat, active_stream_id: "stream", update_time: now - 76 * 60_000 },
        undefined,
        false,
        now,
      ),
    ).toBe("disconnected");
  });
  it("shows genuine drafts after completed work, without inventing status for old chats", () => {
    expect(
      conversationStatus(
        chat,
        { ...run, status: "completed", ended_at: now },
        true,
        now,
      ),
    ).toBe("draft");
    expect(conversationStatus(chat, undefined, false, now)).toBeUndefined();
  });
  it.each(["disconnected", "degraded"])(
    "respects authoritative %s even while the chat retains its active pointer",
    (status) => {
      expect(
        conversationStatus(
          { ...chat, active_trigger_run_id: run.id },
          { ...run, status },
          true,
          now,
        ),
      ).toBe("disconnected");
    },
  );
  it.each([false, true])(
    "keeps a known long-running task active (pointer=%s)",
    (withPointer) => {
      expect(
        conversationStatus(
          withPointer ? { ...chat, active_trigger_run_id: run.id } : chat,
          { ...run, started_at: now - 120 * 60_000 },
          false,
          now,
        ),
      ).toBe("running");
    },
  );
  it("does not infer a running state from unknown server statuses", () => {
    expect(
      conversationStatus(chat, { ...run, status: "future-state" }, false, now),
    ).toBeUndefined();
  });
});
