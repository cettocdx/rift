import { test, expect } from "@playwright/test";
import { isKnownBrowserDiagnostic } from "./browser-diagnostics";

test("only the exact observed WebKit viewport notice is classified as a browser diagnostic", () => {
  const notice =
    'Viewport argument key "interactive-widget" not recognized and ignored.';
  expect(isKnownBrowserDiagnostic("webkit", notice)).toBe(true);
  for (const [engine, message] of [
    ["chromium", notice],
    ["firefox", notice],
    ["webkit", 'Viewport argument key "width" not recognized and ignored.'],
    ["webkit", `${notice} Application failed`],
    ["webkit", "TypeError: Cannot read properties of undefined"],
    ["webkit", "Failed to load resource: 500"],
  ])
    expect(isKnownBrowserDiagnostic(engine, message)).toBe(false);
});
