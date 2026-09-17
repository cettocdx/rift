/**
 * Structural contract for the two prepareStep invariants that fail silently.
 *
 * Both regress into behaviour that still "works" — the run completes, no test
 * goes red, no error is logged — while quietly costing the user money or time.
 * That is exactly the kind of thing worth pinning to the source.
 *
 * Follows the pattern in chat-handler-pty-cleanup.test.ts: read the file,
 * assert structure. The logic lives inside a streamText closure, so exercising
 * it directly would mean mocking the whole SDK for less confidence than this.
 */

import fs from "fs";
import path from "path";

const runnerSrc = fs.readFileSync(
  path.resolve(__dirname, "../agent-stream-runner.ts"),
  "utf8",
);

describe("prepareStep — a summary stays in force for the whole run", () => {
  /*
   * Summarization can fire only once per run (`hasSummarized`), and its result
   * used to be returned for that ONE step. The SDK rebuilds `messages` from its
   * own history every step, so the next step got the full transcript back and
   * the saving evaporated — while the flag guaranteed it could never retry. A
   * long run therefore summarised once near the start and then carried the
   * whole uncompressed history for the remaining fifty-odd steps.
   */
  test("the summarized prefix and its cut index are remembered", () => {
    expect(runnerSrc).toMatch(/let summarizedPrefix/);
    expect(runnerSrc).toMatch(/let summarizedCutIndex/);
    expect(runnerSrc).toMatch(/summarizedPrefix = summarized/);
    expect(runnerSrc).toMatch(/summarizedCutIndex = messages\.length/);
  });

  test("later steps re-splice it in front of what happened since", () => {
    const spliceIdx = runnerSrc.indexOf("...currentMessages.slice(summarizedCutIndex)");
    expect(spliceIdx).toBeGreaterThan(-1);

    // The splice must happen BEFORE the message pipeline runs, or the prefix
    // skips pruning, reminders and the cache breakpoint that every other
    // message gets.
    const pruneIdx = runnerSrc.indexOf("pruneModelMessages(currentMessages)");
    expect(pruneIdx).toBeGreaterThan(spliceIdx);
  });

  test("it refuses to splice a history shorter than the cut it was measured against", () => {
    // Slicing a shorter array would silently drop real turns.
    expect(runnerSrc).toMatch(
      /currentMessages\.length >= summarizedCutIndex/,
    );
  });
});

describe("prepareStep — doom-loop detection can see failures", () => {
  /*
   * The detector fingerprints a step, and for a failing step it must fingerprint
   * the ERROR rather than the arguments: an agent retrying a broken call edits a
   * line each time, so argument fingerprints never matched and thirty
   * consecutive failures never looked like a loop.
   */
  test("the step objects handed to the detector still carry their results", () => {
    const detectIdx = runnerSrc.indexOf("detectDoomLoop(");
    expect(detectIdx).toBeGreaterThan(-1);
    // `steps` is passed whole. Anything that maps it to just toolCalls before
    // this point would reintroduce the blind spot.
    expect(runnerSrc).toMatch(/detectDoomLoop\(\s*steps as unknown/);
  });
});
