import { generateObject } from "ai";
import { z } from "zod";

import { myProvider } from "@/lib/ai/providers";

/**
 * The plan behind the landing page's demo frame.
 *
 * The frame on the marketing page is the product's real chrome, and until now
 * everything inside it was prepared: a visitor typed a task and got back one of
 * three canned runs. The plan is the part worth making real — it is the thing a
 * reader is actually judging ("would it have understood my problem?"), it costs
 * one small completion, and it needs no sandbox.
 *
 * The model writes the plan *and* the answer — what it found, what it would
 * change — so a visitor who types a real problem gets a real response rather
 * than a demonstration of one. That is the part they are judging.
 *
 * What stays prepared: the operation trace, the diff counts, the timings. Those
 * require a container to be honest, and opening one per anonymous visitor is a
 * different product decision with a different bill. The frame says which half
 * is which rather than letting the reader assume.
 */

/** The visitor's prompt is untrusted input from a public, unauthenticated page. */
export const MAX_PROMPT_CHARS = 240;

export const DEMO_SURFACES = ["build", "studio", "workbench"] as const;
export type DemoSurface = (typeof DEMO_SURFACES)[number];

const PlanSchema = z.object({
  reply: z
    .string()
    .describe(
      "One sentence, present tense, describing what you are about to do. No greeting, no restating the request.",
    ),
  answer: z
    .string()
    .describe(
      "The actual answer to the request: the finding, the fix, or the approach, in 2 to 4 sentences. Concrete and specific. If code is the answer, describe the change precisely rather than pasting a file.",
    ),
  steps: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe(
      "The plan, 3 to 5 steps. Each step is an imperative phrase under 60 characters.",
    ),
});

export type DemoPlan = z.infer<typeof PlanSchema>;

const SURFACE_BRIEF: Record<DemoSurface, string> = {
  build:
    "You are RIFT's Build agent. You work inside a real sandbox with a filesystem, a package manager and a terminal, so your plan ends in something executed and verified — never in a suggestion.",
  studio:
    "You are RIFT's Studio agent. You generate images and video through frontier models behind one prompt box. Your plan covers framing, model choice and the render, not code.",
  workbench:
    "You are RIFT's Hack Workbench agent. You run security tooling inside an isolated container against authorised targets only. Your plan always declares scope first and verifies findings before reporting them.",
};

const SYSTEM = `You write the plan an agent is about to execute, and nothing else.

Rules:
- 3 to 5 steps. Fewer if the task is small.
- Each step is an imperative phrase, under 60 characters, no trailing period.
- Steps describe work, not intent: "Read the failing spec", not "Understand the problem".
- The last step verifies the result. Never end on "Report" or "Summarise".
- The reply is one sentence in the present tense, under 120 characters.
- The answer is the real one: what you found, what you would change, or how you
  would approach it. Two to four sentences. Never "I will look into it".
- Answer in the language the request is written in.
- If the request is not a software, media or security task, plan the closest
  thing you can actually do rather than refusing.`;

/**
 * Generate a plan for a prompt.
 *
 * Throws on model failure; the caller is expected to fall back to a prepared
 * run rather than showing the visitor an error — a landing page that says
 * "something went wrong" is worse than one that quietly shows a canned example.
 */
export async function generateDemoPlan(
  prompt: string,
  surface: DemoSurface,
): Promise<DemoPlan> {
  const { object } = await generateObject({
    // DeepSeek V4 Flash: the cheapest model on the roster by a wide margin,
    // which is the whole reason this endpoint can be open to anonymous
    // visitors at all. Note that `ask-model-free` is *not* the right key here
    // despite the name — it was re-routed to Grok 4.3 after DeepSeek's own
    // free route started hard-refusing, so asking for "the free model" by
    // alias would quietly spend on a frontier model instead.
    model: myProvider.languageModel("model-deepseek-v4-flash"),
    schema: PlanSchema,
    system: `${SYSTEM}\n\n${SURFACE_BRIEF[surface]}`,
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    maxOutputTokens: 700,
    temperature: 0.3,
  });

  return {
    reply: object.reply.trim(),
    answer: object.answer.trim(),
    steps: object.steps
      .map((step) => step.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}
