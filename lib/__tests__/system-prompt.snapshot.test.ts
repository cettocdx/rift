/**
 * Snapshot + token-budget guard for `systemPrompt`.
 *
 * Matrix: purpose × mode × subscription × model. Each combination is
 * snapshotted (volatile date text normalised) and its token count checked
 * against a budget measured on 2026-09-02 plus 5% headroom, so a prompt
 * edit that silently balloons the cached prefix fails here first.
 *
 * When a prompt change is intentional: `npx jest -u lib/__tests__/system-prompt.snapshot.test.ts`
 * and re-measure the BUDGET numbers (the failing assertion prints the count).
 */

import { systemPrompt } from "@/lib/system-prompt";
import { safeCountTokens } from "@/lib/token-utils";
import type { ModelName } from "@/lib/ai/providers";
import type { ChatMode, ChatPurpose, SubscriptionTier } from "@/types";

const PURPOSES: ChatPurpose[] = ["app", "security", "image"];
const MODES: ChatMode[] = ["agent", "ask"];
const SUBSCRIPTIONS: SubscriptionTier[] = ["free", "pro"];
const MODELS: ModelName[] = ["model-gpt-5.6-sol", "model-grok-4.3"];

/**
 * Token ceilings per purpose × mode. Values are the largest measured count
 * across subscription × model for that cell × 1.05, rounded up.
 * measured 2026-09-02 (gpt-tokenizer via safeCountTokens):
 *   app/agent      4109 (all four combos identical)
 *   app/ask         894 (all four combos identical)
 *   security/agent 7824 (all four combos identical)
 *   security/ask   1954 free / 1983 pro
 *   image/*         499 (mode and tier are ignored by the image prompt)
 */
const BUDGET: Record<ChatPurpose, Record<ChatMode, number>> = {
  app: { agent: 4315, ask: 939 },
  security: { agent: 8216, ask: 2083 },
  image: { agent: 524, ask: 524 },
};

const WEEKDAY =
  "(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)";
const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const LONG_DATE = new RegExp(`${WEEKDAY}, ${MONTH} \\d{1,2}, \\d{4}`, "g");

/** Strip everything that changes between runs without a code change. */
export function normalizePrompt(prompt: string): string {
  return (
    prompt
      .replace(LONG_DATE, "<DATE>")
      // ISO dates (e.g. note timestamps) — none expected today, guarded anyway.
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<ISO-DATE>")
      // UUID-shaped ids.
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "<UUID>",
      )
  );
}

const measured: Record<string, number> = {};

describe("systemPrompt snapshot matrix", () => {
  for (const purpose of PURPOSES) {
    for (const mode of MODES) {
      for (const subscription of SUBSCRIPTIONS) {
        for (const modelName of MODELS) {
          const name = `${purpose}/${mode}/${subscription}/${modelName}`;

          it(`${name} matches snapshot and stays within budget`, async () => {
            const prompt = await systemPrompt(
              "user_snapshot",
              mode,
              subscription,
              modelName,
              null,
              false,
              null,
              purpose,
            );

            expect(typeof prompt).toBe("string");
            expect(prompt.length).toBeGreaterThan(0);
            // Nothing volatile should survive normalisation.
            const normalized = normalizePrompt(prompt);
            expect(normalized).not.toMatch(LONG_DATE);
            expect(normalized).toMatchSnapshot();

            const tokens = safeCountTokens(prompt);
            measured[name] = tokens;
            const budget = BUDGET[purpose][mode];
            if (tokens > budget) {
              throw new Error(
                `${name}: ${tokens} tokens exceeds budget ${budget} for ${purpose}/${mode}`,
              );
            }
          });
        }
      }
    }
  }

  afterAll(() => {
    if (process.env.PRINT_PROMPT_TOKENS) {
       
      console.log("[system-prompt tokens]", JSON.stringify(measured, null, 2));
    }
  });
});
