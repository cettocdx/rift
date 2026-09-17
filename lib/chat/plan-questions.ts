/**
 * Clarifying questions the agent asks as clickable cards, and how a reply's
 * text is searched for them.
 *
 * The parsing lives here rather than beside the component because what counts
 * as a questions payload is the whole trick: the model is asked to label the
 * block `rift-questions` and does not reliably comply — plain ```rift and
 * ```json have both been seen in the wild — and when the label missed, the user
 * was shown raw machine JSON in a code block where option cards belonged.
 */

export interface PlanQuestionOption {
  label: string;
  detail?: string;
  recommended?: boolean;
}

export interface PlanQuestion {
  id?: string;
  question: string;
  multi?: boolean;
  allowOther?: boolean;
  placeholder?: string;
  options: PlanQuestionOption[];
}

export interface PlanQuestionsData {
  questions: PlanQuestion[];
}

/** Parse a questions payload; returns null when malformed or empty. */
export function parsePlanQuestions(json: string): PlanQuestionsData | null {
  try {
    const data = JSON.parse(json) as PlanQuestionsData;
    if (
      !data ||
      !Array.isArray(data.questions) ||
      data.questions.length === 0
    ) {
      return null;
    }
    const questions = data.questions.filter(
      (q) => q && typeof q.question === "string" && Array.isArray(q.options),
    );
    return questions.length ? { questions } : null;
  } catch {
    return null;
  }
}

/**
 * Fence labels that may carry a questions payload.
 *
 * This list is a filter, not the decision. What actually promotes a block is
 * whether its contents PARSE as questions — a shape (non-empty `questions`,
 * each with a question string and an options array) that nothing else in a
 * reply produces by accident. The labels only keep the scan away from ordinary
 * code fences, so a ```ts block is never even considered.
 */
export const QUESTION_FENCE_LANGS = new Set([
  "rift-questions",
  "riftquestions",
  "rift",
  "questions",
  "json",
  "",
]);

const FENCE_RE = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
/** An opening fence whose closing fence has not arrived yet. */
const OPEN_FENCE_RE = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*)$/;

export interface QuestionsBlockMatch {
  data: PlanQuestionsData;
  /** Index of the opening backticks. */
  start: number;
  /** Index just past the closing backticks. */
  end: number;
}

/** The first fenced block in `text` that really is a questions payload. */
export function findQuestionsBlock(text: string): QuestionsBlockMatch | null {
  // A fresh lastIndex per call: the regex is module-level and /g is stateful,
  // so without this a second call would resume mid-string and miss the block.
  FENCE_RE.lastIndex = 0;
  for (
    let match = FENCE_RE.exec(text);
    match !== null;
    match = FENCE_RE.exec(text)
  ) {
    if (!QUESTION_FENCE_LANGS.has(match[1].toLowerCase())) continue;
    const data = parsePlanQuestions(match[2]);
    if (data) {
      return { data, start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * Where a still-streaming questions payload begins, so the half-written JSON
 * can be hidden until its closing fence arrives.
 *
 * The partial body must already look like a questions payload. Without that
 * test, accepting `json` as a label would blank any reply that is midway
 * through streaming an ordinary JSON block.
 */
export function findOpenQuestionsFence(text: string): number | null {
  const open = text.match(OPEN_FENCE_RE);
  if (!open || open.index === undefined) return null;
  if (!QUESTION_FENCE_LANGS.has(open[1].toLowerCase())) return null;
  // The body runs to the end of the string, so a closing fence inside it means
  // this block is finished — and a finished block that got here is one whose
  // payload did NOT parse. Hiding it would blank a real reply.
  if (open[2].includes("```")) return null;
  if (!/"questions"\s*:/.test(open[2])) return null;
  return open.index;
}

/** Only the newest assistant turn can place a question above the composer. */
export function pendingPlanQuestion(
  messages: readonly {
    id: string;
    role: string;
    parts?: readonly { type: string; text?: unknown }[];
  }[],
) {
  const message = messages.at(-1);
  if (!message || message.role !== "assistant") return null;
  for (let index = (message.parts?.length ?? 0) - 1; index >= 0; index--) {
    const part = message.parts![index];
    if (part.type !== "text" || typeof part.text !== "string") continue;
    const block = findQuestionsBlock(part.text);
    if (block)
      return { key: `${message.id}:${index}:${block.start}`, data: block.data };
  }
  return null;
}
