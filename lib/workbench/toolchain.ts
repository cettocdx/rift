import { PREINSTALLED_PENTESTING_TOOLS } from "@/lib/system-prompt/pentesting-tools";

/**
 * The Hack Workbench toolchain, read off the sandbox's own manifest.
 *
 * `PREINSTALLED_PENTESTING_TOOLS` is the string the agent is actually given,
 * one line per group: `- Group: a, b, c (gloss)`. The heading is the group and
 * the tools are the comma list, counted with the parenthetical glosses removed
 * so a comma inside "(nmap, masscan variants)" does not inflate the total.
 *
 * Parsed rather than transcribed, and parsed in one place rather than two.
 * Every surface that sells the Workbench quotes these numbers — the landing's
 * deep-dive section and the upgrade page's gate — and a hand-kept copy beside
 * either of them is a number that goes stale the first time a tool is added.
 */
export function parseToolchain(manifest: string) {
  const groups: { name: string; count: number }[] = [];
  let total = 0;
  for (const raw of manifest.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ") || !line.includes(":")) continue;
    const colon = line.indexOf(":");
    const head = line.slice(2, colon);
    const rest = line.slice(colon + 1);
    const withoutParens = rest.replace(/\([^)]*\)/g, "");
    const n = withoutParens.split(",").filter((t) => t.trim()).length;
    groups.push({ name: head.trim(), count: n });
    total += n;
  }
  return { groups, total };
}

/** The parsed manifest — the shape every Workbench surface quotes. */
export const TOOLCHAIN = parseToolchain(PREINSTALLED_PENTESTING_TOOLS);
