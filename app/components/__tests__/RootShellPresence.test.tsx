import { StrictMode } from "react";
import { createPortal } from "react-dom";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RootShellPresence, registerRootShell } from "../RootShellPresence";
import { ChatViewport } from "../chat-layout/ChatViewport";

function Shell({ text = "Transcript" }: { text?: string }) {
  return (
    <div className="pro-shell">
      <RootShellPresence kind="pro" />
      {text}
    </div>
  );
}
test("nested/overlapping shell owners retain portal markers until the last release", () => {
  const first = registerRootShell(document, "pro");
  const second = registerRootShell(document, "pro");
  const workspace = registerRootShell(document, "workspace");
  expect(document.body.hasAttribute("data-rift-shell-pro")).toBe(true);
  expect(document.documentElement.hasAttribute("data-rift-shell-pro")).toBe(
    true,
  );
  first();
  first();
  expect(document.body.hasAttribute("data-rift-shell-pro")).toBe(true);
  second();
  expect(document.body.hasAttribute("data-rift-shell-pro")).toBe(false);
  expect(document.body.hasAttribute("data-rift-shell-workspace")).toBe(true);
  workspace();
  expect(document.body.hasAttribute("data-rift-shell-workspace")).toBe(false);
});
test("body-owned portal selectors remain matched; content updates do not mutate root attributes", () => {
  const bodySet = jest.spyOn(document.body, "setAttribute");
  const htmlSet = jest.spyOn(document.documentElement, "setAttribute");
  function Page({ show, text }: { show: boolean; text: string }) {
    return (
      <>
        {show && <Shell text={text} />}{" "}
        {createPortal(<div role="menu">Portal</div>, document.body)}
      </>
    );
  }
  const view = render(
    <StrictMode>
      <Page show text="first" />
    </StrictMode>,
  );
  expect(
    screen.getByRole("menu").matches('body[data-rift-shell-pro] [role="menu"]'),
  ).toBe(true);
  const bodyCount = bodySet.mock.calls.length;
  const htmlCount = htmlSet.mock.calls.length;
  view.rerender(
    <StrictMode>
      <Page show text="streamed text" />
    </StrictMode>,
  );
  expect(bodySet.mock.calls.length).toBe(bodyCount);
  expect(htmlSet.mock.calls.length).toBe(htmlCount);
  view.rerender(
    <StrictMode>
      <Page show={false} text="signed out" />
    </StrictMode>,
  );
  expect(document.body.hasAttribute("data-rift-shell-pro")).toBe(false);
  expect(document.documentElement.hasAttribute("data-rift-shell-pro")).toBe(
    false,
  );
  expect(
    screen.getByRole("menu").matches('body[data-rift-shell-pro] [role="menu"]'),
  ).toBe(false);
  bodySet.mockRestore();
  htmlSet.mockRestore();
});
test("chat marker follows the actual route viewport, not loading or unauthenticated viewports", () => {
  const view = render(<ChatViewport>Loading</ChatViewport>);
  expect(document.body.hasAttribute("data-rift-shell-chat")).toBe(false);
  view.rerender(
    <ChatViewport data-rift-route-shell="chat">Authenticated</ChatViewport>,
  );
  expect(document.body.hasAttribute("data-rift-shell-chat")).toBe(true);
  view.rerender(<ChatViewport>Signed out</ChatViewport>);
  expect(document.body.hasAttribute("data-rift-shell-chat")).toBe(false);
});
test("global styles use explicit root markers while retaining local relational selectors", () => {
  const read = (file: string) =>
    readFileSync(resolve(process.cwd(), file), "utf8");
  const files = [
    "app/globals.css",
    "app/styles/workspace.css",
    "app/styles/typography.css",
    "app/styles/mobile-chat.css",
  ];
  for (const file of files) {
    const css = read(file);
    expect(css).not.toMatch(/body:has\(|:has\(body|body:is\(:has/);
    expect(css).toContain("body[data-rift-shell-pro]");
  }
  expect(read("app/styles/workspace.css")).toContain(
    ".pro-shell [data-rift-empty-content]:has([data-studio-discovery])",
  );
  expect(read("app/globals.css")).toContain(
    'html[data-rift-appearance="ready"][data-rift-shell-pro]:is(html)',
  );
  expect(read("app/styles/typography.css")).toContain(
    "body:is([data-rift-shell-pro], [data-rift-shell-workspace])",
  );
});
