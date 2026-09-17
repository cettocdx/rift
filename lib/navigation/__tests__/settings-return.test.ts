import {
  readSettingsReturn,
  rememberSettingsReturn,
  validSettingsReturn,
} from "../settings-return";

beforeEach(() => sessionStorage.clear());

it("returns to the conversation after visiting multiple settings sections", () => {
  rememberSettingsReturn("/c/saved-chat?view=review#file");
  rememberSettingsReturn("/settings");
  rememberSettingsReturn("/settings/appearance");
  expect(readSettingsReturn("/")).toBe("/c/saved-chat?view=review#file");
});

it("remembers a newly visited destination rather than an older conversation", () => {
  rememberSettingsReturn("/c/saved-chat");
  rememberSettingsReturn("/plugins");
  expect(readSettingsReturn("/")).toBe("/plugins");
});

it.each([
  "//example.com",
  "/\\example.com",
  "https://example.com",
  "/login",
  "/settings/appearance",
  "javascript:alert(1)",
])("rejects an invalid return target %s", (href) => {
  expect(validSettingsReturn(href)).toBe("/");
});

it("keeps a lab shell within its own base route", () => {
  expect(validSettingsReturn("/c/root-chat", "/lab/app")).toBe("/lab/app");
  expect(validSettingsReturn("/lab/app/c/test", "/lab/app")).toBe(
    "/lab/app/c/test",
  );
});
