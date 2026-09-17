import { isStandaloneTextTurn } from "../standalone-text-turn";
import type { UIMessage } from "ai";
const msg = (text: string): UIMessage => ({
  id: "m",
  role: "user",
  parts: [{ type: "text", text }],
});
const context = { purpose: "app" };
it.each([
  "Without using any tools, explain closures.",
  "Do not use tools. Answer this question.",
  "Hiçbir araç kullanmadan yalnızca TAMAM yaz.",
  "Araç kullanmadan bunu açıkla.",
])("honors an explicit fresh text-only request: %s", (text) => {
  expect(isStandaloneTextTurn([msg(text)], context)).toBe(true);
});
it.each([
  "Explain closures",
  "Fix my app",
  "Quote: without using any tools",
  '"Do not use tools." ne demek?',
  "Without using toolshed equipment, build it.",
])("does not guess or match quoted instructions: %s", (text) => {
  expect(isStandaloneTextTurn([msg(text)], context)).toBe(false);
});
it("preserves work and non-text context", () => {
  const m = msg("Without using tools, explain this");
  for (const ctx of [
    { purpose: "security" },
    { ...context, hasWorkContext: true },
    { ...context, continuation: true },
  ])
    expect(isStandaloneTextTurn([m], ctx)).toBe(false);
  expect(isStandaloneTextTurn([m, m], context)).toBe(false);
  expect(isStandaloneTextTurn([{ ...m, role: "assistant" }], context)).toBe(
    false,
  );
  expect(
    isStandaloneTextTurn(
      [
        {
          ...m,
          parts: [
            ...m.parts,
            { type: "file", mediaType: "text/plain", url: "file:///a" },
          ],
        },
      ],
      context,
    ),
  ).toBe(false);
});
