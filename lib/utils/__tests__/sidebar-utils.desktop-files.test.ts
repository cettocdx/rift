import {
  extractAllSidebarContent,
  extractSidebarContentFromMessage,
  type Message,
} from "../sidebar-utils";
import {
  getPerFileDiffStats,
  getRunDiffStat,
} from "@/app/components/agent-activity";
import { isSidebarFile } from "@/types/chat";

const read = (overrides: Record<string, unknown> = {}) => ({
  type: "tool-desktop_workspace_read",
  toolCallId: "read-1",
  state: "output-available",
  input: { grantId: "grant-a", relativePath: "notes.md" },
  output: {
    ok: true,
    file: {
      relativePath: "notes.md",
      content: "one\ntwo",
      encoding: "utf8",
      version: "v1",
    },
  },
  ...overrides,
});
const write = (overrides: Record<string, unknown> = {}) => ({
  type: "tool-desktop_workspace_write",
  toolCallId: "write-1",
  state: "output-available",
  input: {
    grantId: "grant-a",
    relativePath: "notes.md",
    content: "one\nthree\nfour",
    encoding: "utf8",
    expectedVersion: "v1",
  },
  output: {
    ok: true,
    file: { relativePath: "notes.md", size: 14, version: "v2" },
  },
  ...overrides,
});
const extract = (...parts: NonNullable<Message["parts"]>) =>
  extractSidebarContentFromMessage({ role: "assistant", parts });

describe("native working-file sidebar extraction", () => {
  it("shows a confirmed write and its version-matched read as an accurate diff", () => {
    const result = extract(read(), write());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      path: "notes.md",
      action: "reading",
      content: "one\ntwo",
    });
    expect(result[1]).toMatchObject({
      path: "notes.md",
      action: "editing",
      originalContent: "one\ntwo",
      modifiedContent: "one\nthree\nfour",
      content: "one\nthree\nfour",
      toolCallId: "write-1",
    });
    expect(getPerFileDiffStats(result)).toEqual([
      expect.objectContaining({
        path: "notes.md",
        added: 2,
        removed: 1,
        execution: result[1],
      }),
    ]);
    expect(getRunDiffStat(result)).toEqual({ added: 2, removed: 1 });
  });

  it.each([
    "input-available",
    "approval-requested",
    "approval-responded",
    "output-denied",
    "output-error",
  ])("does not report a write in %s as changed", (state) => {
    expect(getPerFileDiffStats(extract(read(), write({ state })))).toEqual([]);
  });

  it.each([
    { ok: false, error: "Conflict" },
    { denied: true },
    { ok: "true" },
    undefined,
  ])("ignores failed, denied, or unconfirmed write output %p", (output) => {
    expect(getPerFileDiffStats(extract(read(), write({ output })))).toEqual([]);
  });

  it.each([
    { grantId: "grant-b", relativePath: "notes.md", expectedVersion: "v1" },
    { grantId: "grant-a", relativePath: "notes.md", expectedVersion: "stale" },
    { grantId: "grant-a", relativePath: "notes.md" },
  ])(
    "keeps confirmed writes visible without inventing their unknown before content: %p",
    (identity) => {
      const result = extract(
        read(),
        write({
          input: {
            ...write().input,
            ...identity,
            expectedVersion: identity.expectedVersion,
          },
        }),
      );
      const edited = result
        .filter(isSidebarFile)
        .find((file) => file.action === "editing");
      expect(edited).toMatchObject({
        content: "one\nthree\nfour",
        diffUnavailable: true,
      });
      expect(edited?.originalContent).toBeUndefined();
      expect(getPerFileDiffStats(result)).toEqual([
        expect.objectContaining({
          added: 0,
          removed: 0,
          diffUnavailable: true,
        }),
      ]);
      expect(getRunDiffStat(result)).toEqual({ added: 0, removed: 0 });
    },
  );

  it("does not match a later read or another message's read", () => {
    for (const result of [
      extract(write(), read()),
      extractAllSidebarContent([
        { role: "assistant", parts: [read()] },
        { role: "assistant", parts: [write()] },
      ]),
    ]) {
      expect(getPerFileDiffStats(result)[0]).toMatchObject({
        diffUnavailable: true,
        added: 0,
        removed: 0,
      });
    }
  });

  it("does not trust failed reads, binary reads, or a returned path that differs", () => {
    for (const output of [
      { ...read().output, ok: false },
      { ok: true, file: { ...read().output.file, encoding: "base64" } },
      { ok: true, file: { ...read().output.file, relativePath: "other.md" } },
    ]) {
      expect(
        getPerFileDiffStats(extract(read({ output }), write()))[0],
      ).toMatchObject({ diffUnavailable: true });
    }
  });

  it("preserves an empty successful write as deletion of the previous lines", () => {
    const result = extract(
      read(),
      write({ input: { ...write().input, content: "" } }),
    );
    expect(result[1]).toMatchObject({
      content: "",
      modifiedContent: "",
      originalContent: "one\ntwo",
    });
    expect(getPerFileDiffStats(result)[0]).toMatchObject({
      added: 0,
      removed: 2,
    });
  });

  it("ignores a mismatched write-result path", () => {
    expect(
      getPerFileDiffStats(
        extract(
          read(),
          write({ output: { ok: true, file: { relativePath: "other.md" } } }),
        ),
      ),
    ).toEqual([]);
  });
});
