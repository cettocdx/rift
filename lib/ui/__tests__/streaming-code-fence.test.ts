import { streamingCodeFence } from "../streaming-code-fence";
it("keeps unfinished code verbatim", () => {
  expect(
    streamingCodeFence('```ts\nconst a = "<script>";\n// **text**'),
  ).toEqual({ language: "ts", code: 'const a = "<script>";\n// **text**' });
});
it("delegates closed, mixed and ambiguous blocks", () => {
  for (const source of [
    "paragraph\n```ts\na",
    "```ts\na\n```",
    "~~~js\na\n~~~~\ntext",
    "```bad`info\na",
  ])
    expect(streamingCodeFence(source)).toBeNull();
});
it("respects fence length and marker inside source", () => {
  expect(streamingCodeFence("````ts\n```\nconst x=1;")?.code).toBe(
    "```\nconst x=1;",
  );
  expect(streamingCodeFence('~~~\nconst x="```";')?.language).toBe("");
});

import { standaloneCodeFence } from "../streaming-code-fence";

it("extracts the same full source before and after a standalone fence closes", () => {
  const source = 'const a = "<script>";\n// **text**\n';
  expect(standaloneCodeFence("```ts\n" + source)).toEqual({
    language: "ts",
    code: source,
    closed: false,
  });
  expect(standaloneCodeFence("```ts\n" + source + "```\n\n")).toEqual({
    language: "ts",
    code: source,
    closed: true,
  });
});
it("requires a matching fence and delegates prose, indentation and ambiguous info", () => {
  for (const source of [
    "paragraph\n```ts\na",
    " ```ts\n a\n ```",
    "```ts\na\n```\ntext",
    "```bad`info\na",
  ])
    expect(standaloneCodeFence(source)).toBeNull();
  expect(standaloneCodeFence("````ts\n```\nconst x=1;\n````")?.code).toBe(
    "```\nconst x=1;\n",
  );
  expect(standaloneCodeFence("~~~js\na\n  ~~~~\t")).toEqual({
    language: "js",
    code: "a\n",
    closed: true,
  });
  expect(standaloneCodeFence("```ts\na\n~~~")?.closed).toBe(false);
});
