import { describe, it, expect } from "@jest/globals";
import {
  createStepFingerprint,
  detectDoomLoop,
  generateDoomLoopNudge,
  DOOM_LOOP_WARNING_THRESHOLD,
  DOOM_LOOP_HALT_THRESHOLD,
  DOOM_LOOP_REPEAT_WINDOW,
} from "../doom-loop-detection";

function makeStep(toolCalls: Array<{ toolName: string; input: unknown }>) {
  return { toolCalls };
}

describe("createStepFingerprint", () => {
  it("returns sentinel for steps with no tool calls", () => {
    expect(createStepFingerprint(makeStep([]))).toBe("__no_tools__");
  });

  it("returns consistent fingerprint for same tool call", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    expect(createStepFingerprint(step)).toBe(createStepFingerprint(step));
  });

  it("sorts tool calls by name for deterministic fingerprint", () => {
    const step1 = makeStep([
      { toolName: "b_tool", input: {} },
      { toolName: "a_tool", input: {} },
    ]);
    const step2 = makeStep([
      { toolName: "a_tool", input: {} },
      { toolName: "b_tool", input: {} },
    ]);
    expect(createStepFingerprint(step1)).toBe(createStepFingerprint(step2));
  });

  it("different args produce different fingerprints", () => {
    const step1 = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const step2 = makeStep([{ toolName: "file", input: { path: "/b.txt" } }]);
    expect(createStepFingerprint(step1)).not.toBe(createStepFingerprint(step2));
  });

  it("ignores brief field when fingerprinting", () => {
    const step1 = makeStep([
      {
        toolName: "file",
        input: { action: "read", path: "/a.txt", brief: "Read the file" },
      },
    ]);
    const step2 = makeStep([
      {
        toolName: "file",
        input: {
          action: "read",
          path: "/a.txt",
          brief: "Retry reading the file",
        },
      },
    ]);
    expect(createStepFingerprint(step1)).toBe(createStepFingerprint(step2));
  });

  it("ignores explanation field when fingerprinting", () => {
    const step1 = makeStep([
      {
        toolName: "run_terminal_cmd",
        input: { command: "ls", explanation: "List files" },
      },
    ]);
    const step2 = makeStep([
      {
        toolName: "run_terminal_cmd",
        input: { command: "ls", explanation: "Trying again to list" },
      },
    ]);
    expect(createStepFingerprint(step1)).toBe(createStepFingerprint(step2));
  });
});

describe("detectDoomLoop", () => {
  it("returns none for empty steps", () => {
    expect(detectDoomLoop([])).toEqual({
      severity: "none",
      toolNames: [],
      consecutiveCount: 0,
      pattern: "consecutive",
    });
  });

  it("returns none for fewer steps than warning threshold", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const steps = Array(DOOM_LOOP_WARNING_THRESHOLD - 1).fill(step);
    expect(detectDoomLoop(steps).severity).toBe("none");
  });

  it("returns warning at exactly warning threshold identical steps", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const steps = Array(DOOM_LOOP_WARNING_THRESHOLD).fill(step);
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("warning");
    expect(result.toolNames).toEqual(["file"]);
    expect(result.consecutiveCount).toBe(DOOM_LOOP_WARNING_THRESHOLD);
  });

  it("returns warning between warning and halt thresholds", () => {
    const step = makeStep([
      { toolName: "run_terminal_cmd", input: { command: "ls" } },
    ]);
    const steps = Array(DOOM_LOOP_HALT_THRESHOLD - 1).fill(step);
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("warning");
    expect(result.consecutiveCount).toBe(DOOM_LOOP_HALT_THRESHOLD - 1);
  });

  it("returns halt at exactly halt threshold identical steps", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const steps = Array(DOOM_LOOP_HALT_THRESHOLD).fill(step);
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("halt");
    expect(result.consecutiveCount).toBe(DOOM_LOOP_HALT_THRESHOLD);
  });

  it("returns halt above halt threshold", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const steps = Array(DOOM_LOOP_HALT_THRESHOLD + 3).fill(step);
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("halt");
  });

  it("still catches a repeat when another tool call sits in the middle", () => {
    const stepA = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const stepB = makeStep([
      { toolName: "run_terminal_cmd", input: { command: "pwd" } },
    ]);
    // A, A, B, A, A. The trailing run is only 2, so the consecutive rule saw
    // nothing here -- but /a.txt was read four times in five steps and every
    // read returned the same bytes. One intervening step is all it ever took
    // to hide a loop from this detector.
    const result = detectDoomLoop([stepA, stepA, stepB, stepA, stepA]);
    expect(result.severity).toBe("warning");
    expect(result.pattern).toBe("repeat");
    expect(result.consecutiveCount).toBe(4);
  });

  it("still catches a repeat across a step that called no tools at all", () => {
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const noToolStep = makeStep([]);
    // A step that only produced text used to reset the count to zero, so an
    // agent that narrated between identical calls was invisible.
    const steps = [step, step, step, noToolStep, step, step];
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("halt");
    expect(result.pattern).toBe("repeat");
    expect(result.consecutiveCount).toBe(5);
  });

  it("catches the alternating verify loop, which is the shape that costs time", () => {
    // screenshot, read it, screenshot, read it... Neither call is ever
    // back-to-back with itself, so the consecutive rule can never fire.
    const shot = makeStep([
      { toolName: "screenshot", input: { url: "http://localhost:3000" } },
    ]);
    const read = makeStep([{ toolName: "file", input: { path: "/og.jpg" } }]);
    const result = detectDoomLoop([shot, read, shot, read, shot, read]);
    expect(result.severity).toBe("warning");
    expect(result.pattern).toBe("repeat");
    expect(generateDoomLoopNudge(result)).toContain("in your last");
  });

  it("lets an agent wait on a terminal as long as the terminal needs", () => {
    // Identical `wait` calls are a build finishing, not a loop. Halting here
    // would kill the runs that are actually working.
    const wait = makeStep([
      {
        toolName: "interact_terminal_session",
        input: { action: "wait", sessionId: "s1" },
      },
    ]);
    expect(detectDoomLoop(Array(8).fill(wait)).severity).toBe("none");
  });

  it("forgets a repeat that has fallen out of the window", () => {
    // A long task may legitimately come back to a file much later. Only a
    // recent cluster is a loop.
    const step = makeStep([{ toolName: "file", input: { path: "/a.txt" } }]);
    const other = (i: number) =>
      makeStep([{ toolName: "file", input: { path: `/other${i}.txt` } }]);
    const steps = [
      step,
      step,
      ...Array.from({ length: DOOM_LOOP_REPEAT_WINDOW }, (_, i) => other(i)),
      step,
    ];
    expect(detectDoomLoop(steps).severity).toBe("none");
  });

  it("returns none when same tool has different args each time", () => {
    const steps = Array.from({ length: 5 }, (_, i) =>
      makeStep([{ toolName: "file", input: { path: `/file${i}.txt` } }]),
    );
    expect(detectDoomLoop(steps).severity).toBe("none");
  });

  it("detects loop when only brief/explanation differs between calls", () => {
    const steps = [
      makeStep([
        {
          toolName: "file",
          input: {
            action: "read",
            path: "/home/user/.credentials/api_key.txt",
            brief: "Read the API key file as requested",
          },
        },
      ]),
      makeStep([
        {
          toolName: "file",
          input: {
            action: "read",
            path: "/home/user/.credentials/api_key.txt",
            brief: "Retry reading the API key file",
          },
        },
      ]),
      makeStep([
        {
          toolName: "file",
          input: {
            action: "read",
            path: "/home/user/.credentials/api_key.txt",
            brief: "Third attempt to read the API key file",
          },
        },
      ]),
    ];
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("warning");
    expect(result.toolNames).toEqual(["file"]);
    expect(result.consecutiveCount).toBe(3);
  });

  it("handles steps with multiple tool calls", () => {
    const step = makeStep([
      { toolName: "file", input: { path: "/a.txt" } },
      { toolName: "run_terminal_cmd", input: { command: "ls" } },
    ]);
    const steps = Array(DOOM_LOOP_WARNING_THRESHOLD).fill(step);
    const result = detectDoomLoop(steps);
    expect(result.severity).toBe("warning");
    expect(result.toolNames).toContain("file");
    expect(result.toolNames).toContain("run_terminal_cmd");
  });
});

describe("generateDoomLoopNudge", () => {
  it("includes tool name and count", () => {
    const nudge = generateDoomLoopNudge({
      severity: "warning",
      toolNames: ["file"],
      consecutiveCount: 3,
      pattern: "consecutive",
    });
    expect(nudge).toContain("file");
    expect(nudge).toContain("3 times");
    expect(nudge).toContain("[LOOP DETECTED]");
  });

  it("includes multiple tool names", () => {
    const nudge = generateDoomLoopNudge({
      severity: "warning",
      toolNames: ["file", "run_terminal_cmd"],
      consecutiveCount: 4,
      pattern: "consecutive",
    });
    expect(nudge).toContain("file");
    expect(nudge).toContain("run_terminal_cmd");
    expect(nudge).toContain("4 times");
  });

  it("tells the model the result it wants is already in hand", () => {
    // The old nudge said "try a different approach", which an agent
    // re-verifying its own work reads as "verify it a different way" -- more
    // steps, not fewer. The point is that the answer is already above.
    const nudge = generateDoomLoopNudge({
      severity: "warning",
      toolNames: ["screenshot"],
      consecutiveCount: 3,
      pattern: "repeat",
      windowSize: 6,
    });
    expect(nudge).toContain("3 times in your last 6 steps");
    expect(nudge).toContain("You already have the result");
  });
});

/*
 * The loop that used to be invisible.
 *
 * An agent retrying a broken call almost never sends byte-identical input — it
 * edits a line, renames a variable, adds a flag. Fingerprinting on arguments
 * therefore saw thirty different steps where a reader would see one error
 * thirty times, and production runs spent the whole 58-minute budget this way.
 */
describe("detectDoomLoop — repeated failures", () => {
  const failingStep = (attempt: number) => ({
    toolCalls: [
      {
        toolName: "file",
        // Different every time, which is exactly why input alone could not see it.
        input: { action: "edit", path: `/app/x.ts`, text: `attempt ${attempt}` },
      },
    ],
    toolResults: [
      {
        toolName: "file",
        output: { error: `Cannot find module './missing' at line ${attempt}` },
      },
    ],
  });

  it("catches the same failure repeating under varied arguments", () => {
    const steps = Array.from({ length: 6 }, (_, i) => failingStep(i));
    const result = detectDoomLoop(steps);

    expect(result.severity).not.toBe("none");
    expect(result.toolNames).toContain("file");
  });

  it("stays quiet when the tool starts succeeding again", () => {
    const steps = [
      failingStep(0),
      failingStep(1),
      failingStep(2),
      failingStep(3),
      failingStep(4),
      {
        toolCalls: [{ toolName: "file", input: { action: "edit", path: "/app/x.ts" } }],
        toolResults: [{ toolName: "file", output: { content: "fixed" } }],
      },
    ];

    expect(detectDoomLoop(steps).severity).toBe("none");
  });

  // Half a step working is progress: only an ALL-failed step is fingerprinted
  // as an error, so this falls back to the argument fingerprint, which differs.
  it("treats a partly successful step as progress, not a loop", () => {
    const mixed = (attempt: number) => ({
      toolCalls: [
        { toolName: "file", input: { action: "edit", text: `try ${attempt}` } },
        { toolName: "run_terminal_cmd", input: { command: `pnpm build ${attempt}` } },
      ],
      toolResults: [
        { toolName: "file", output: { error: "boom" } },
        { toolName: "run_terminal_cmd", output: { stdout: "built ok" } },
      ],
    });

    expect(
      detectDoomLoop(Array.from({ length: 6 }, (_, i) => mixed(i))).severity,
    ).toBe("none");
  });

  // Oscillating between two failures IS a loop — fix A breaks B, fix B breaks
  // A — and the window-based pattern is there to catch exactly that. Pinned so
  // nobody "fixes" the alternating case back into invisibility.
  it("catches an agent oscillating between two failures", () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({
      toolCalls: [{ toolName: "file", input: { attempt: i } }],
      toolResults: [
        {
          toolName: "file",
          output: {
            error: i % 2 === 0 ? "permission denied" : "no such file",
          },
        },
      ],
    }));

    expect(detectDoomLoop(steps).severity).not.toBe("none");
  });

  it("ignores one failure among otherwise varied work", () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({
      toolCalls: [{ toolName: "file", input: { path: `/app/${i}.ts` } }],
      toolResults: [
        {
          toolName: "file",
          output: i === 2 ? { error: "permission denied" } : { content: "ok" },
        },
      ],
    }));

    expect(detectDoomLoop(steps).severity).toBe("none");
  });

  it("still works when the caller has no results to give", () => {
    const steps = Array.from({ length: 6 }, () => ({
      toolCalls: [{ toolName: "file", input: { action: "read", path: "/a" } }],
    }));

    expect(detectDoomLoop(steps).severity).not.toBe("none");
  });

  it("recognises the success:false shape as a failure", () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({
      toolCalls: [{ toolName: "create_note", input: { title: `n${i}` } }],
      toolResults: [
        {
          toolName: "create_note",
          output: { success: false, message: "note store unavailable" },
        },
      ],
    }));

    expect(detectDoomLoop(steps).severity).not.toBe("none");
  });
});
