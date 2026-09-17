/** Single runtime command validator shared by browser bundles and the Node CLI. */
export const CONSOLE_MAX_INPUT_LENGTH = 32_000;
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value, max = 512) {
  return typeof value === "string" && value.length <= max;
}
export function validateConsoleCommand(value) {
  if (!record(value)) return false;
  if (value.type === "new-chat") return true;
  if (value.type === "answer")
    return (
      text(value.id) &&
      text(value.chatId) &&
      text(value.text, 32000) &&
      value.text.trim().length > 0
    );
  if (value.type === "approve")
    return (
      text(value.id) && text(value.chatId) && typeof value.approve === "boolean"
    );
  if (value.type === "submit" || value.type === "stop") {
    if (value.chatId !== null && !text(value.chatId)) return false;
    return (
      value.type === "stop" ||
      (text(value.text, CONSOLE_MAX_INPUT_LENGTH) &&
        value.text.trim().length > 0)
    );
  }
  return (
    [
      "set-model",
      "set-effort",
      "set-approval",
      "set-mode",
      "set-target",
    ].includes(String(value.type)) && text(value.value)
  );
}
