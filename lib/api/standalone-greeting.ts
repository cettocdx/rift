import type { UIMessage } from "ai";

/** Only a fresh, text-only greeting can omit external tool discovery.
 * Never interpret a short instruction, continuation, attachment or project task
 * as small talk. The selected model still generates the actual reply.
 */
export function isStandaloneGreetingTurn(
  messages: UIMessage[],
  context: {
    purpose: string;
    hasWorkContext?: boolean;
    continuation?: boolean;
  },
): boolean {
  if (
    context.purpose !== "app" ||
    context.hasWorkContext ||
    context.continuation ||
    messages.length !== 1
  )
    return false;
  const [message] = messages;
  if (
    message.role !== "user" ||
    !message.parts.length ||
    message.parts.some((p) => p.type !== "text")
  )
    return false;
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim()
    .toLocaleLowerCase("tr");
  return (
    text.length <= 80 &&
    /^(?:merhaba(?:lar)?|selam(?:lar)?|günaydın|iyi (?:akşamlar|geceler)|hello|hi|hey|good (?:morning|evening))(?:[!.,\s]*(?:nasılsın(?:ız)?|how are you))?[!?.\s]*$/u.test(
      text,
    )
  );
}
