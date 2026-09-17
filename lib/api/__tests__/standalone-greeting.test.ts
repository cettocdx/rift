import { isStandaloneGreetingTurn } from "../standalone-greeting";
import type { UIMessage } from "ai";
const message = (text: string): UIMessage => ({
  id: "m",
  role: "user",
  parts: [{ type: "text", text }],
});
const context = { purpose: "app" };
it.each([
  "merhaba",
  "Merhabalar!",
  "selam, nasılsın?",
  "hello",
  "Hi!",
  "good morning",
])("can answer %s without external tools", (text) => {
  expect(isStandaloneGreetingTurn([message(text)], context)).toBe(true);
});
it.each([
  "merhaba dosyayı düzenle",
  "hi, inspect files",
  "devam",
  "yes",
  "run tests",
  "merhaba /build",
  "selam @agent",
])("keeps tools available for %s", (text) => {
  expect(isStandaloneGreetingTurn([message(text)], context)).toBe(false);
});
it("never strips tools from ongoing work, attachments, or project/profile requests", () => {
  expect(
    isStandaloneGreetingTurn([message("merhaba")], {
      ...context,
      hasWorkContext: true,
    }),
  ).toBe(false);
  expect(
    isStandaloneGreetingTurn([message("merhaba")], {
      ...context,
      continuation: true,
    }),
  ).toBe(false);
  expect(
    isStandaloneGreetingTurn([message("merhaba")], { purpose: "security" }),
  ).toBe(false);
  expect(
    isStandaloneGreetingTurn(
      [message("build it"), message("merhaba")],
      context,
    ),
  ).toBe(false);
  expect(
    isStandaloneGreetingTurn(
      [
        {
          ...message("merhaba"),
          parts: [
            { type: "text", text: "merhaba" },
            { type: "file", mediaType: "text/plain", url: "file:///a" },
          ],
        },
      ],
      context,
    ),
  ).toBe(false);
});
