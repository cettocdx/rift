export type ConsolePairing = { port: number; token: string };

/** An explicit, local-only capability. Never accept a host supplied by a link. */
export function parseConsolePairing(hash: string): ConsolePairing | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("riftConsole");
  const match = raw?.match(/^(\d{1,5}):([a-zA-Z0-9_-]{43,128})$/);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535 ? { port, token: match[2] } : null;
}

export function withoutConsolePairing(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  params.delete("riftConsole");
  const rest = params.toString();
  return rest ? `#${rest}` : "";
}
