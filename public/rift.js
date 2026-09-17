#!/usr/bin/env node
/**
 * RIFT terminal client. Drive the full RIFT agent from your terminal.
 *
 *   export RIFT_API_KEY=rift_live_...        # from Settings → API Keys
 *   curl -s https://riftsys.app/rift.js | RIFT_API_KEY=$RIFT_API_KEY node - "build me a landing page"
 *
 * Or save it and run:  node rift.js "scan example.com for open ports"
 *
 * Env vars:
 *   RIFT_API_KEY   (required) your personal key
 *   RIFT_BASE_URL  (optional) defaults to https://riftsys.app
 *   RIFT_PURPOSE   (optional) app | security | image   (default: security)
 *   RIFT_MODE      (optional) agent | ask               (default: agent)
 *
 * Requires Node 18+ (built-in fetch + crypto).
 */
const BASE_URL = process.env.RIFT_BASE_URL || "https://riftsys.app";
const API_KEY = process.env.RIFT_API_KEY;
const PURPOSE = process.env.RIFT_PURPOSE || "security";
const MODE = process.env.RIFT_MODE || "agent";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!API_KEY) {
    console.error("Set RIFT_API_KEY first:  export RIFT_API_KEY=rift_live_...");
    process.exit(1);
  }
  if (!prompt) {
    console.error('Usage: node rift.js "<prompt>"');
    process.exit(1);
  }

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      chatId: crypto.randomUUID(),
      mode: MODE,
      purpose: PURPOSE,
      temporary: true,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    console.error(`RIFT request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!frame.startsWith("data: ")) continue;
      const raw = frame.slice(6);
      if (raw === "[DONE]") {
        process.stdout.write("\n");
        return;
      }
      let part;
      try {
        part = JSON.parse(raw);
      } catch {
        continue;
      }
      switch (part.type) {
        case "text-delta":
          process.stdout.write(part.delta ?? "");
          break;
        case "tool-input-available":
          process.stdout.write(`\n\x1b[2m[${part.toolName}]\x1b[0m\n`);
          break;
        case "error":
          process.stderr.write(`\n[error] ${part.errorText}\n`);
          process.exitCode = 1;
          break;
        default:
          break;
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
