import type { UIMessage } from "ai";

/** Explicit opt-out only. Do not infer required capabilities from prompt length. */
export function isStandaloneTextTurn(
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
  const message = messages[0];
  if (
    message.role !== "user" ||
    !message.parts.length ||
    message.parts.some((p) => p.type !== "text")
  )
    return false;
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
  // Only a direct leading instruction, never a quoted example or historical text.
  return /^(?:without using (?:any )?tools\b|do not use (?:any )?tools[.!\s]|hiçbir araç kullanmadan\s|araç kullanmadan\s)/iu.test(
    text,
  );
}
