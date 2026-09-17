import { getProviderContext } from "@/lib/ai/provider-context";
// Categories RIFT hard-blocks regardless of the selected upstream media model.
const BLOCKED_MEDIA_CATEGORIES = ["sexual/minors", "csae"] as const;

/**
 * Applies RIFT's narrow, provider-independent hard block before a billable
 * media request. It intentionally fails open when the moderation service is
 * not configured or temporarily unavailable; upstream model safety remains in
 * effect in that case.
 */
export async function isMediaPromptHardBlocked(
  prompt: string,
  origin = getProviderContext(),
): Promise<boolean> {
  const key = origin.openaiApiKey;
  if (!key) return false;

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: prompt }),
    });
    if (!response.ok) return false;

    const data = (await response.json()) as {
      results?: Array<{ categories?: Record<string, boolean> }>;
    };
    const categories = data.results?.[0]?.categories ?? {};
    return BLOCKED_MEDIA_CATEGORIES.some(
      (category) => categories[category] === true,
    );
  } catch {
    return false;
  }
}
