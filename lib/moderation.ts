import {
  getProviderContext,
  type ProviderContext,
} from "./ai/provider-context";
import OpenAI from "openai";
import { encode, decode } from "gpt-tokenizer";
import { isStandaloneGreetingTurn } from "./api/standalone-greeting";

const MODERATION_TOKEN_LIMIT = 512;

// Reuse the last matching configuration without retaining another deployment's
// credentials. Each returned SDK client owns explicit configuration for its life.
let openaiSingleton: { context: ProviderContext; client: OpenAI } | undefined;
function getOpenAIClient(context: ProviderContext): OpenAI {
  const previous = openaiSingleton?.context;
  if (
    !previous ||
    previous.openaiApiKey !== context.openaiApiKey ||
    previous.openaiBaseUrl !== context.openaiBaseUrl ||
    previous.openaiOrganization !== context.openaiOrganization ||
    previous.openaiProject !== context.openaiProject
  ) {
    openaiSingleton = {
      context,
      client: new OpenAI({
        apiKey: context.openaiApiKey,
        baseURL: context.openaiBaseUrl ?? "https://api.openai.com/v1",
        organization: context.openaiOrganization ?? null,
        project: context.openaiProject ?? null,
      }),
    };
  }
  return openaiSingleton!.client;
}

export async function getModerationResult(
  messages: any[],
  isPaidUser: boolean,
  options: { signal?: AbortSignal; standaloneGreeting?: boolean } = {},
): Promise<{ shouldUncensorResponse: boolean; moderationText: string }> {
  options.signal?.throwIfAborted();
  // Pure greetings need no authorization-reinforcing prompt. Keep the
  // conservative default, rather than waiting for a classification whose
  // positive result is unnecessary. Validate content as well as caller context.
  if (
    options.standaloneGreeting &&
    isStandaloneGreetingTurn(messages, { purpose: "app" })
  ) {
    return { shouldUncensorResponse: false, moderationText: "" };
  }
  const providerContext = getProviderContext();
  const openaiApiKey = providerContext.openaiApiKey;

  if (!openaiApiKey) {
    return { shouldUncensorResponse: false, moderationText: "" };
  }

  const openai = getOpenAIClient(providerContext);

  // Find the last user message that exceeds the minimum length
  const targetMessage = findTargetMessage(messages, 30);

  if (!targetMessage) {
    return { shouldUncensorResponse: false, moderationText: "" };
  }

  const input = prepareInput(targetMessage);

  try {
    const moderation = await openai.moderations.create(
      {
        model: "omni-moderation-latest",
        input: input,
      },
      { timeout: 4000, maxRetries: 0, signal: options.signal },
    );
    options.signal?.throwIfAborted();

    // Check if moderation results exist and are not empty
    if (!moderation?.results || moderation.results.length === 0) {
      console.error("Moderation API returned no results");
      return { shouldUncensorResponse: false, moderationText: input };
    }

    const result = moderation.results[0];
    const moderationLevel = calculateModerationLevel(result.category_scores);
    const hazardCategories = Object.entries(result.categories)
      .filter(([, isFlagged]) => isFlagged)
      .map(([category]) => category);

    const shouldUncensorResponse = determineShouldUncensorResponse(
      moderationLevel,
      hazardCategories,
      isPaidUser,
    );

    // console.log(
    //   JSON.stringify(moderation, null, 2),
    //   moderationLevel,
    //   hazardCategories,
    //   shouldUncensorResponse,
    // );

    return { shouldUncensorResponse, moderationText: input };
  } catch (_error: any) {
    options.signal?.throwIfAborted();
    // console.error('Error in getModerationResult:', error);
    return { shouldUncensorResponse: false, moderationText: "" };
  }
}

function findTargetMessage(messages: any[], minLength: number): any | null {
  const MIN_FALLBACK_LENGTH = 5;
  let combinedContent = "";
  let userMessagesChecked = 0;
  const messagesToCombine: any[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      userMessagesChecked++;
      messagesToCombine.push(message);

      // Handle UIMessage format with parts array
      if (message.parts && Array.isArray(message.parts)) {
        const textContent = message.parts
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join(" ");

        combinedContent = textContent + " " + combinedContent;
      }

      // Check if we've reached the minimum length
      if (combinedContent.trim().length >= minLength) {
        return createCombinedMessage(messagesToCombine);
      }

      if (userMessagesChecked >= 3) {
        break; // Stop after checking three user messages
      }
    }
  }

  // If we have some content but it's less than minLength, check if it's at least MIN_FALLBACK_LENGTH
  if (
    combinedContent.trim().length >= MIN_FALLBACK_LENGTH &&
    messagesToCombine.length > 0
  ) {
    return createCombinedMessage(messagesToCombine);
  }

  return null;
}

function createCombinedMessage(messages: any[]): any {
  const combinedParts: any[] = [];

  // Reverse to get chronological order
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.parts && Array.isArray(message.parts)) {
      const textParts = message.parts.filter(
        (part: any) => part.type === "text",
      );
      combinedParts.push(...textParts);
    }
  }

  return {
    role: "user",
    parts: combinedParts,
  };
}

function prepareInput(message: any): string {
  // Handle UIMessage format with parts array
  if (message.parts && Array.isArray(message.parts)) {
    const textContent = message.parts
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join(" ");

    return truncateByTokens(textContent);
  }
  // Fallback: Handle legacy string content format
  else if (typeof message.content === "string") {
    return truncateByTokens(message.content);
  }
  return "";
}

function truncateByTokens(content: string): string {
  const tokens = encode(content);
  if (tokens.length <= MODERATION_TOKEN_LIMIT) {
    return content;
  }

  // For large inputs, include both beginning and end for better context
  const halfLimit = Math.floor(MODERATION_TOKEN_LIMIT / 2);
  const startTokens = tokens.slice(0, halfLimit);
  const endTokens = tokens.slice(-halfLimit);

  return decode(startTokens) + " [...] " + decode(endTokens);
}

function calculateModerationLevel(
  categoryScores: OpenAI.Moderations.Moderation.CategoryScores,
): number {
  const maxScore = Math.max(
    ...Object.values(categoryScores).filter(
      (score): score is number => typeof score === "number",
    ),
  );
  return Math.min(Math.max(maxScore, 0), 1);
}

function determineShouldUncensorResponse(
  _moderationLevel: number,
  hazardCategories: string[],
  _isPaidUser: boolean,
): boolean {
  // The platform pre-verifies authorization and the system prompt already
  // establishes it; the auth disclaimer is reinforcement. Apply it to ANY
  // request that is not in a genuinely harmful category, regardless of tier or
  // moderation score. This removes false refusals on legitimate (including
  // aggressive) authorized-pentest requests — the prior gating required the
  // message to score within a narrow 0.1–0.9/0.98 band, so most security asks
  // (which OpenAI moderation barely scores) never got the authorization framing
  // and free users got it even less than paid. The forbidden categories below
  // STILL gate it: sexual content (especially involving minors / CSAM) is never
  // "uncensored". This is the one hard safety line and must stay.
  const forbiddenCategories = ["sexual", "sexual/minors"];
  const hasForbiddenCategory = hazardCategories.some((category) =>
    forbiddenCategories.includes(category),
  );

  return !hasForbiddenCategory;
}
