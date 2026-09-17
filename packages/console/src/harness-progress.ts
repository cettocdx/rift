/**
 * Doom Loop Detection
 *
 * Detects when the agent is spending steps without gaining anything: calling
 * the same tool(s) with identical arguments over and over. Inspired by
 * OpenCode's doom loop detection (sst/opencode PR #3445).
 *
 * Two shapes, because real loops come in two shapes.
 *
 * CONSECUTIVE -- the same step back to back. Cheap to spot, and what the
 * original rule looked for.
 *
 * REPEAT -- the same step several times inside a short window, with other
 * steps in between. This is the one that actually costs users time, and the
 * consecutive rule cannot see it at all: an agent verifying its work tends to
 * alternate (screenshot, read it, screenshot, read it), and a single
 * intervening step reset the consecutive counter to one every time. A run that
 * opened the same two images five times in a row down one branch registered as
 * no loop whatsoever, and the minutes it burned were invisible to every stop
 * condition.
 *
 * Identical arguments is the whole test. Reading the same path twice in twelve
 * steps tells you nothing the first read did not; there is no version of that
 * which is progress.
 *
 * Two-tier response for either shape:
 * - Warning (3 occurrences): inject a nudge as a user message
 * - Halt (5 occurrences): stop generation entirely
 */

export const DOOM_LOOP_WARNING_THRESHOLD = 3;
export const DOOM_LOOP_HALT_THRESHOLD = 5;

/**
 * How far back a repeat still counts.
 *
 * Twelve steps is roughly one verify-and-adjust cycle. Wider than that and a
 * long task legitimately revisits a file; narrower and the alternating loops
 * this exists to catch fall straight through the gap.
 */
export const DOOM_LOOP_REPEAT_WINDOW = 12;

export type DoomLoopSeverity = "none" | "warning" | "halt";

/** Which shape was found: back-to-back, or scattered through a short window. */
export type DoomLoopPattern = "consecutive" | "repeat";

export interface DoomLoopResult {
  severity: DoomLoopSeverity;
  toolNames: string[];
  /**
   * How many times the offending step was seen. For "consecutive" that is a
   * trailing run; for "repeat" it is the count inside the window.
   */
  consecutiveCount: number;
  pattern: DoomLoopPattern;
  /** Steps examined for a "repeat"; the window actually searched. */
  windowSize?: number;
}

interface MinimalToolCall {
  toolName: string;
  input?: unknown;
}

interface MinimalToolResult {
  toolName?: string;
  output?: unknown;
}

export interface MinimalStep {
  toolCalls: MinimalToolCall[];
  /**
   * The step's results, when the caller has them.
   *
   * Optional because plenty of callers only have the calls, and because a
   * fingerprint must still be computable without them.
   */
  toolResults?: MinimalToolResult[];
}

// Fields in tool inputs that are cosmetic descriptions (change each call even
// when the functional arguments are identical). Stripped before fingerprinting.
const COSMETIC_INPUT_FIELDS = new Set(["brief", "explanation"]);

/**
 * Calls whose whole job is to watch something change.
 *
 * Waiting on a terminal returns different output each time by design, so a run
 * of identical `wait` calls is a build finishing, not an agent going in
 * circles. Counting them as a loop would halt exactly the runs that are
 * working -- and the wider window below makes that far easier to hit than the
 * old back-to-back rule did, so the exemption has to exist before it ships.
 */
function isLiveObservation(call: MinimalToolCall): boolean {
  if (call.toolName !== "interact_terminal_session") return false;
  const action = (call.input as { action?: unknown } | undefined)?.action;
  return action === "wait" || action === "view";
}

/** Sentinel for a step that only watched; it can never be part of a loop. */
export const OBSERVATION_FINGERPRINT = "__observation__";

function stripCosmeticFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([key]) => !COSMETIC_INPUT_FIELDS.has(key),
  );
  return Object.fromEntries(entries);
}

/**
 * Creates a deterministic fingerprint for a step's tool calls.
 * Steps with no tool calls return a sentinel that breaks any loop chain.
 * Strips cosmetic fields (brief, explanation) that change per-call.
 */
/** The error text a failing tool result carries, in the shapes tools use. */
function extractToolErrorText(output: unknown): string | null {
  if (typeof output === "string") {
    // The SDK renders a thrown tool error as plain text.
    return /^error\b/i.test(output.trim()) ? output : null;
  }
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;

  if (typeof record.error === "string") return record.error;
  if (record.success === false) {
    return typeof record.message === "string" ? record.message : "failed";
  }
  if (record.isError === true || record.type === "error-text") {
    const text = record.text ?? record.value ?? record.message;
    return typeof text === "string" ? text : "error";
  }
  return null;
}

/**
 * Collapse an error message to the thing that repeats.
 *
 * Two attempts at the same broken thing rarely produce byte-identical text —
 * a line number moves, a temp path changes, a timestamp ticks. Normalising
 * those away is what lets the detector see one error happening thirty times
 * instead of thirty different errors.
 */
function normalizeErrorSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * The step's errors, keyed by tool, or null when the step did not fail.
 *
 * A failing step is fingerprinted on WHAT WENT WRONG rather than on the
 * arguments, which is the blind spot this closes: an agent retrying a broken
 * call almost never sends byte-identical input — it edits one line, renames a
 * variable, adds a flag — so the input fingerprint changed every time and
 * thirty consecutive failures never looked like a loop. Production runs burned
 * the full 58-minute budget this way.
 */
function createErrorFingerprint(step: MinimalStep): string | null {
  const results = step.toolResults;
  if (!results || results.length === 0) return null;

  const errors: { toolName: string; error: string }[] = [];
  for (const result of results) {
    const text = extractToolErrorText(result?.output);
    if (text === null) return null; // A step that partly succeeded is progress.
    errors.push({
      toolName: result?.toolName ?? "unknown",
      error: normalizeErrorSignature(text),
    });
  }
  if (errors.length === 0) return null;

  errors.sort(
    (a, b) =>
      a.toolName.localeCompare(b.toolName) || a.error.localeCompare(b.error),
  );
  return `__error__${JSON.stringify(errors)}`;
}

export function createStepFingerprint(step: MinimalStep): string {
  if (!step.toolCalls || step.toolCalls.length === 0) {
    return "__no_tools__";
  }

  if (step.toolCalls.every(isLiveObservation)) {
    return OBSERVATION_FINGERPRINT;
  }

  // Errors take precedence over arguments: repeating the same failure is the
  // loop, whatever the agent changed about how it asked.
  const errorFingerprint = createErrorFingerprint(step);
  if (errorFingerprint !== null) return errorFingerprint;

  const sorted = [...step.toolCalls]
    .map((tc) => ({
      toolName: tc.toolName,
      input: stripCosmeticFields(tc.input),
    }))
    .sort((a, b) => a.toolName.localeCompare(b.toolName));

  // Re-reading the same path can be progress when the file changed. Preserve
  // result evidence rather than treating identical arguments alone as a loop.
  return JSON.stringify({
    calls: sorted,
    results: step.toolResults?.map((result) => ({
      toolName: result.toolName,
      output: result.output,
    })),
  });
}

/**
 * Detects doom loops by counting trailing identical step fingerprints.
 */
export function detectDoomLoop(steps: MinimalStep[]): DoomLoopResult {
  const none: DoomLoopResult = {
    severity: "none",
    toolNames: [],
    consecutiveCount: 0,
    pattern: "consecutive",
  };

  if (steps.length < DOOM_LOOP_WARNING_THRESHOLD) {
    return none;
  }

  // Get fingerprint of the last step
  const lastStep = steps[steps.length - 1];
  const lastFingerprint = createStepFingerprint(lastStep);

  // Neither a silent step nor a step that only watched can form a loop.
  if (
    lastFingerprint === "__no_tools__" ||
    lastFingerprint === OBSERVATION_FINGERPRINT
  ) {
    return none;
  }

  // Count how many trailing steps share the same fingerprint
  let count = 1;
  for (let i = steps.length - 2; i >= 0; i--) {
    if (createStepFingerprint(steps[i]) === lastFingerprint) {
      count++;
    } else {
      break;
    }
  }

  const toolNames = [...new Set(lastStep.toolCalls.map((tc) => tc.toolName))];

  if (count >= DOOM_LOOP_WARNING_THRESHOLD) {
    return {
      severity: count >= DOOM_LOOP_HALT_THRESHOLD ? "halt" : "warning",
      toolNames,
      consecutiveCount: count,
      pattern: "consecutive",
    };
  }

  // Not back to back -- but the same call may still be circling. Count how
  // often this exact step appears in the recent window, gaps included.
  const window = steps.slice(-DOOM_LOOP_REPEAT_WINDOW);
  let repeats = 0;
  for (const step of window) {
    if (createStepFingerprint(step) === lastFingerprint) {
      repeats++;
    }
  }

  if (repeats < DOOM_LOOP_WARNING_THRESHOLD) {
    return none;
  }

  return {
    severity: repeats >= DOOM_LOOP_HALT_THRESHOLD ? "halt" : "warning",
    toolNames,
    consecutiveCount: repeats,
    pattern: "repeat",
    windowSize: window.length,
  };
}

/**
 * Generates a nudge message to inject as a trailing user message when a doom
 * loop is detected. The message guides the model to break out of the loop.
 */
export function generateDoomLoopNudge(result: DoomLoopResult): string {
  const toolList = result.toolNames.join(", ");
  const where =
    result.pattern === "repeat"
      ? `${result.consecutiveCount} times in your last ${result.windowSize ?? DOOM_LOOP_REPEAT_WINDOW} steps`
      : `${result.consecutiveCount} times in a row`;

  return (
    `[LOOP DETECTED] You have called ${toolList} ${where} with identical arguments. ` +
    `Those calls returned the same thing every time, so they bought you nothing and cost the user minutes. ` +
    `You MUST NOT make that call again. Instead:\n` +
    `- You already have the result. Use what the earlier call returned rather than fetching it again.\n` +
    `- If you were re-checking your own work, the check is done. Move to the next unfinished step.\n` +
    `- If a command or tool keeps failing, read the error carefully and change your strategy — different parameters, a different tool, or a different method entirely.\n` +
    `- If you genuinely cannot make progress, say what you tried and ask the user, rather than looping.`
  );
}
