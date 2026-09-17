import { parseSlashCommand } from "./slash-command-registry";

export type ComposerSegment = Readonly<{
  text: string;
  /** `command` is a slash invocation the runtime will actually resolve. */
  kind: "command" | "plain";
}>;

/**
 * Splits composer text into the leading slash invocation and the rest.
 *
 * The split has to agree with the runtime exactly, or the colour becomes a lie:
 * a token painted as a command that the parser then rejects is worse than no
 * colour at all. So this asks `parseSlashCommand` rather than matching a
 * pattern of its own, and only a `command` result is painted -- an unknown name
 * stays plain while it is still being typed, and turns the moment it resolves.
 */
export function splitComposerCommand(input: string): ComposerSegment[] {
  if (!input) return [];

  const parsed = parseSlashCommand(input);
  if (parsed.kind !== "command") return [{ text: input, kind: "plain" }];

  // `parseSlashCommand` trims before matching, so the invocation starts at the
  // first slash rather than at index 0 when the field opens with whitespace.
  const start = input.indexOf("/");
  const end = start + 1 + parsed.invokedAs.length;
  const segments: ComposerSegment[] = [];

  if (start > 0) segments.push({ text: input.slice(0, start), kind: "plain" });
  segments.push({ text: input.slice(start, end), kind: "command" });
  if (end < input.length) {
    segments.push({ text: input.slice(end), kind: "plain" });
  }

  return segments;
}
