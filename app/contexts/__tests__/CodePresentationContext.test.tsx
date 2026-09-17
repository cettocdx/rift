import { fireEvent, render, screen } from "@testing-library/react";
import { CodeHighlight } from "@/app/components/CodeHighlight";
import {
  CodePresentationProvider,
  CodePresentationScope,
  useCodeWrapping,
} from "../CodePresentationContext";
import type { ChatViewState } from "../ChatViewStateContext";

function Code({
  id = "message:part:0",
  source = "original code",
  language = "plain",
}) {
  return (
    <CodePresentationScope identity={id}>
      <CodeHighlight className={`language-${language}`}>{source}</CodeHighlight>
    </CodePresentationScope>
  );
}
function tree(view: ChatViewState | undefined, code: React.ReactNode) {
  return (
    <CodePresentationProvider view={view}>{code}</CodePresentationProvider>
  );
}
const wrap = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Enable text wrapping", exact: true }),
  );
const wrapped = () =>
  expect(
    screen.getByRole("button", { name: "Disable text wrapping", exact: true }),
  ).toBeInTheDocument();
const unwrapped = () =>
  expect(
    screen.getByRole("button", { name: "Enable text wrapping", exact: true }),
  ).toBeInTheDocument();

it("restores a chosen wrap before route return and preserves explicit disable", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <Code />));
  wrap();
  r.rerender(tree(view, null));
  r.rerender(tree(view, <Code />));
  wrapped();
  fireEvent.click(
    screen.getByRole("button", { name: "Disable text wrapping", exact: true }),
  );
  r.rerender(tree(view, null));
  r.rerender(tree(view, <Code />));
  unwrapped();
});
it("preserves streaming growth, closure, and append-only growth while away", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <Code source="const x" />));
  wrap();
  r.rerender(tree(view, <Code source="const x = 1;\n" />));
  wrapped();
  r.rerender(tree(view, null));
  r.rerender(tree(view, <Code source="const x = 1;\nconst y = 2;\n" />));
  wrapped();
});
it.each(["replacement", "truncation", "language", "identity", "account"])(
  "does not inherit a choice across %s",
  (change) => {
    const view: ChatViewState = {};
    const r = render(tree(view, <Code source="original" />));
    wrap();
    r.rerender(tree(view, <Code source="original extended" />));
    r.rerender(tree(view, null));
    r.rerender(
      tree(
        change === "account" ? {} : view,
        <Code
          source={
            change === "replacement"
              ? "changed"
              : change === "truncation"
                ? "original"
                : "original extended"
          }
          language={change === "language" ? "other" : "plain"}
          id={change === "identity" ? "another-block" : "message:part:0"}
        />,
      ),
    );
    unwrapped();
  },
);
it("does not share identical snippets across block identities", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <Code id="one" />));
  wrap();
  r.rerender(tree(view, <Code id="two" />));
  unwrapped();
  r.rerender(tree(view, <Code id="one" />));
  wrapped();
});
it("without a view or block identity keeps only local state", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <CodeHighlight>local</CodeHighlight>));
  wrap();
  r.rerender(tree(view, null));
  r.rerender(tree(view, <CodeHighlight>local</CodeHighlight>));
  unwrapped();
  expect(view.codePresentation).toBeUndefined();
});
function Choice({ id, source }: { id: string; source: string }) {
  const [value, toggle] = useCodeWrapping(id, source);
  return (
    <button onClick={toggle}>
      {id}:{String(value)}
    </button>
  );
}
it("bounds source characters and entries without truncating the rendered source", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <Choice id="0" source={"x".repeat(100_000)} />));
  for (let i = 0; i < 3; i++) {
    r.rerender(
      tree(view, <Choice id={String(i)} source={"x".repeat(100_000)} />),
    );
    fireEvent.click(screen.getByRole("button"));
  }
  expect(view.codePresentation?.size).toBe(2);
  expect(view.codePresentation?.has("0")).toBe(false);
  for (let i = 0; i < 70; i++) {
    r.rerender(tree(view, <Choice id={`small-${i}`} source="full source" />));
    fireEvent.click(screen.getByRole("button"));
  }
  expect(view.codePresentation?.size).toBe(64);
  expect(
    [...view.codePresentation!.values()].every(
      (receipt) => receipt.source === "full source",
    ),
  ).toBe(true);
});

it("resets a same-prefix replacement against the latest committed revision", () => {
  const view: ChatViewState = {};
  const r = render(tree(view, <Code source="abc" />));
  wrap();
  r.rerender(tree(view, <Code source="abcdef" />));
  wrapped();
  r.rerender(tree(view, <Code source="abcpqr" />));
  unwrapped();
});
it("does not manufacture a block identity under unscoped Markdown", () => {
  const view: ChatViewState = {};
  const block = (
    <CodePresentationScope>
      <CodePresentationScope identity="0" requireParent>
        <CodeHighlight>same source</CodeHighlight>
      </CodePresentationScope>
    </CodePresentationScope>
  );
  const r = render(tree(view, block));
  wrap();
  expect(view.codePresentation).toBeUndefined();
  r.rerender(tree(view, null));
  r.rerender(tree(view, block));
  unwrapped();
});
