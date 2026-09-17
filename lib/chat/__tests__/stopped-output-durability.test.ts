import fs from "node:fs";
import path from "node:path";

/**
 * E3. A stopped run's partial output used to survive only if the browser's
 * fire-and-forget save request landed. The producer -- which already holds the
 * same output -- refused to insert it, because `updateOnly: true` was applied
 * to every abort.
 *
 * That flag exists to stop a DISCARDED turn (regenerate / edit / retry) from
 * being re-created as an orphan. Telling the two apart depended on a Redis
 * message, and a dropped message defaulted to "discard" -- the destructive
 * choice. The intent is now recorded on the chat row, so the producer can read
 * it durably and only refuse to insert when the user is actually discarding.
 */
describe("a stopped run's partial output is durable", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("records the discard intent on the chat row, not only over Redis", () => {
    const chatStreams = read("convex/chatStreams.ts");
    expect(chatStreams).toContain("cancel_skip_save:");
    // The cancel mutation writes it beside canceled_at.
    expect(chatStreams).toMatch(
      /canceled_at: Date\.now\(\),[\s\S]{0,600}cancel_skip_save:/,
    );
    // And the producer can read it back.
    expect(chatStreams).toContain("cancel_skip_save: chat.cancel_skip_save");
  });

  it("clears the intent when a new stream starts, so it cannot leak forward", () => {
    // Left set, the intent would make the NEXT stop look like a regenerate and
    // silently discard that run's output.
    const chatStreams = read("convex/chatStreams.ts");
    expect(chatStreams).toMatch(
      /active_stream_id: args\.streamId,[\s\S]{0,400}cancel_skip_save: undefined/,
    );
  });

  it("narrows updateOnly to the discard case in both producers", () => {
    const handler = read("lib/api/chat-handler.ts");
    const worker = read("trigger/agent-long.ts");

    // Neither producer may apply updateOnly to every abort any more.
    expect(handler).toMatch(
      /updateOnly:\s*\n\s*isAborted &&\s*\n\s*!isPreemptiveAbort &&\s*\n\s*shouldSkipSaveSignal/,
    );
    expect(worker).toMatch(
      /updateOnly:\s*\n\s*isAborted &&\s*\n\s*!state\.stoppedDueToElapsedTimeout &&\s*\n\s*cancelDiscardsOutput/,
    );
  });

  it("resolves the intent durably when no cancellation message arrived", () => {
    const cancellation = read("lib/utils/stream-cancellation.ts");
    expect(cancellation).toContain("resolveSkipSave");
    // Both the pub/sub and the polling path must be able to answer.
    expect(cancellation).toContain("readDurableSkipSave");
    // Failure defaults to keeping the output.
    expect(cancellation).toMatch(/catch \{\s*\n\s*return false;/);
  });

  it("has the handler resolve the intent rather than trusting the signal alone", () => {
    const handler = read("lib/api/chat-handler.ts");
    expect(handler).toContain(
      "await cancellationSubscriber.resolveSkipSave()",
    );
  });
});
