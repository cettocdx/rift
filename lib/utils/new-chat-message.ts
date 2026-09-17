import { v4 as uuidv4 } from "uuid";

let pendingMessage: { id: string; text: string } | null = null;

/** Bind a test submission to one navigation without putting its text in a URL. */
export function queueNewChatMessage(text: string): string {
  const id = uuidv4();
  pendingMessage = { id, text: text.trim() };
  return `/?agentTest=${encodeURIComponent(id)}`;
}

/** Only the matching, ready destination may consume the intent, once. */
export function takeNewChatMessage(id: string): string | null {
  if (pendingMessage?.id !== id) return null;
  const { text } = pendingMessage;
  pendingMessage = null;
  return text;
}
