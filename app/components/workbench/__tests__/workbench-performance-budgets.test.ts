import type { WorkbenchDocument } from "../types";
import {
  appendBoundedTerminalScrollbackChunks,
  MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES,
} from "../terminal-scrollback";
import { readWorkbenchDraft, writeWorkbenchDraft } from "../workbench-drafts";

function document(
  path: string,
  content: string,
  savedContent = content,
): WorkbenchDocument {
  return {
    path,
    content,
    savedContent,
    revision: `revision:${path}`,
    size: content.length,
    modifiedAt: "2026-07-18T12:00:00.000Z",
    status: "ready",
    error: null,
    conflict: null,
  };
}

describe("Workbench performance hard caps", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("bounds a burst of PTY chunks to the newest 128 KiB", () => {
    const chunks = Array.from({ length: 1_024 }, (_, index) =>
      new Uint8Array(256).fill(index % 251),
    );

    const bounded = appendBoundedTerminalScrollbackChunks(
      new Uint8Array(),
      chunks,
    );

    expect(bounded).toHaveLength(MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES);
    expect(bounded[0]).toBe(512 % 251);
    expect(bounded.at(-1)).toBe(1_023 % 251);
  });

  it("persists at most 20 editor documents", () => {
    const documents = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => {
        const path = `src/file-${index}.ts`;
        return [path, document(path, `export const value = ${index};`)];
      }),
    );
    const openTabs = Object.keys(documents);

    expect(
      writeWorkbenchDraft("budget:document-count", {
        openTabs,
        activePath: openTabs[0],
        documents,
      }),
    ).toBe(true);

    const restored = readWorkbenchDraft("budget:document-count");
    expect(restored?.openTabs).toHaveLength(20);
    expect(Object.keys(restored?.documents ?? {})).toHaveLength(20);
  });

  it("skips per-document and aggregate draft payloads beyond their budgets", () => {
    const small = document("src/small.ts", "small");
    const oversizedText = "x".repeat(1_000_001);
    const oversized = document("src/oversized.ts", oversizedText);

    expect(
      writeWorkbenchDraft("budget:per-document", {
        openTabs: [small.path, oversized.path],
        activePath: small.path,
        documents: { [small.path]: small, [oversized.path]: oversized },
      }),
    ).toBe(true);
    expect(readWorkbenchDraft("budget:per-document")?.openTabs).toEqual([
      small.path,
    ]);

    const largeDocuments = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => {
        const path = `src/large-${index}.ts`;
        return [path, document(path, String(index).repeat(400_000))];
      }),
    );
    const largeTabs = Object.keys(largeDocuments);

    expect(
      writeWorkbenchDraft("budget:aggregate", {
        openTabs: largeTabs,
        activePath: largeTabs[0],
        documents: largeDocuments,
      }),
    ).toBe(true);
    expect(readWorkbenchDraft("budget:aggregate")?.openTabs).toHaveLength(3);
  });
});
