/** Match the native bridge: web URLs and exact about:blank, never credentials. */
export function normalizeBrowserAddress(input: string): string | null {
  if (input.length > 4096 || /[\u0000-\u001f\u007f-\u009f\\]/u.test(input))
    return null;
  const value = input.trim();
  if (!value || value.startsWith("//")) return null;
  if (value === "about:blank") return value;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  const explicitWeb = /^https?:\/\//i.test(value);
  const hostPort = /^(?:[^/:?#\s]+|\[[\da-f:]+\]):\d+(?=[/?#]|$)/i.test(value);
  if (
    scheme &&
    !explicitWeb &&
    (!hostPort ||
      /^(?:https?|javascript|data|file|blob|about|tauri|rift|mailto|ftp|wss?)$/.test(
        scheme,
      ))
  )
    return null;
  try {
    const local =
      /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=[/?#]|$)/i.test(value);
    const url = new URL(
      explicitWeb ? value : `${local ? "http" : "https"}://${value}`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (!url.hostname || /\s/.test(url.hostname) || url.href.length > 4096)
      return null;
    return url.href;
  } catch {
    return null;
  }
}
