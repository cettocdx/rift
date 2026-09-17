import type { WorkbenchDocument } from "../types";
import { readWorkbenchDraft, writeWorkbenchDraft } from "../workbench-drafts";

function document(
  path: string,
  content: string,
  savedContent: string,
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

describe("workbench session drafts", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("restores open tabs, the active path, and unsaved buffer content", () => {
    const dirty = document(
      "src/app.ts",
      "const value = 2;",
      "const value = 1;",
    );
    const clean = document("README.md", "# Rift", "# Rift");

    expect(
      writeWorkbenchDraft("project:alpha", {
        openTabs: [clean.path, dirty.path],
        activePath: dirty.path,
        documents: { [clean.path]: clean, [dirty.path]: dirty },
      }),
    ).toBe(true);

    const restored = readWorkbenchDraft("project:alpha");
    expect(restored?.openTabs).toEqual([clean.path, dirty.path]);
    expect(restored?.activePath).toBe(dirty.path);
    expect(restored?.documents[dirty.path]).toMatchObject({
      content: "const value = 2;",
      savedContent: "const value = 1;",
      status: "ready",
    });
  });

  it("isolates drafts by workspace scope", () => {
    const alpha = document("alpha.ts", "alpha draft", "alpha");
    writeWorkbenchDraft("project:alpha", {
      openTabs: [alpha.path],
      activePath: alpha.path,
      documents: { [alpha.path]: alpha },
    });

    expect(readWorkbenchDraft("project:beta")).toBeNull();
    expect(readWorkbenchDraft("project:alpha")?.activePath).toBe("alpha.ts");
  });

  it("fails closed and removes malformed storage", () => {
    const storage = window.sessionStorage;
    storage.setItem("rift:workbench:drafts:v1:standalone", "not-json");

    expect(readWorkbenchDraft("standalone", storage)).toBeNull();
    expect(storage.length).toBe(0);
  });
});
