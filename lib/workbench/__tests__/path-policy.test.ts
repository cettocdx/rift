import {
  WORKBENCH_ROOT,
  absoluteWorkspacePath,
  isWorkspaceEntryVisible,
  normalizeWorkspacePath,
  relativeWorkspacePath,
  workspaceRevision,
} from "@/lib/workbench/path-policy";

describe("Workbench path policy", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    [".", ""],
    ["project/src/../app.ts", "project/app.ts"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeWorkspacePath(input)).toBe(expected);
  });

  it.each([
    "/etc/passwd",
    "../etc/passwd",
    "project/../../etc/passwd",
    "project\\src\\app.ts",
    `project/${"a".repeat(1_025)}`,
    "project/src\napp.ts",
  ])("rejects a path outside the workspace: %s", (path) => {
    expect(() => normalizeWorkspacePath(path)).toThrow();
  });

  it.each([
    ".ssh/id_rsa",
    ".git/config",
    ".config/gh/hosts.yml",
    ".git-credentials",
    ".gitconfig",
    ".bash_history",
    ".rift-workbench-state/tmp/file",
    "agent-transcripts/chat.json",
    "terminal_full_output/run.log",
    "go/bin/tool",
    "SecLists/Passwords/common.txt",
    "project/.env",
    "project/node_modules/pkg/index.js",
    "project/.next/server.js",
  ])("rejects protected sandbox data: %s", (path) => {
    expect(() => normalizeWorkspacePath(path)).toThrow();
  });

  it("keeps ordinary dotfiles visible", () => {
    expect(isWorkspaceEntryVisible("", ".gitignore")).toBe(true);
    expect(isWorkspaceEntryVisible("", ".vscode")).toBe(true);
    expect(isWorkspaceEntryVisible("project", ".gitignore")).toBe(true);
    expect(isWorkspaceEntryVisible("project", ".env.example")).toBe(true);
    expect(isWorkspaceEntryVisible("project", ".config")).toBe(true);
  });

  it("round-trips a path under the sandbox home", () => {
    const absolute = absoluteWorkspacePath("project/src/app.ts");
    expect(absolute).toBe(`${WORKBENCH_ROOT}/project/src/app.ts`);
    expect(relativeWorkspacePath(absolute)).toBe("project/src/app.ts");
  });

  it("creates stable content revisions", () => {
    expect(workspaceRevision("hello")).toBe(
      workspaceRevision(Buffer.from("hello")),
    );
    expect(workspaceRevision("hello")).not.toBe(workspaceRevision("world"));
  });
});
