/** @jest-environment node */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWorkingDirectory } from "../utils";

describe("local runner working directory", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rift-cwd-")));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    "directory with spaces",
    "directory's apostrophe",
    "directory $(touch substitution-marker)",
    "directory `touch substitution-marker`",
    "directory' $(touch substitution-marker) `touch substitution-marker`",
  ])("runs inside literal directory %s without evaluating it", (name) => {
    const directory = join(root, name);
    mkdirSync(directory);
    const result = spawnSync(
      "/bin/sh",
      ["-c", withWorkingDirectory("pwd -P", directory, false)],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    expect(existsSync(join(root, "substitution-marker"))).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(directory);
  });

  it("does not execute the requested command after a failed directory change", () => {
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        withWorkingDirectory(
          "touch command-marker",
          join(root, "missing"),
          false,
        ),
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, "command-marker"))).toBe(false);
  });

  it("preserves commands with no requested directory and the cmd.exe prefix", () => {
    expect(withWorkingDirectory("echo ready", undefined, false)).toBe(
      "echo ready",
    );
    expect(withWorkingDirectory("echo ready", "  ", false)).toBe("echo ready");
    expect(withWorkingDirectory("echo ready", "C:\\project folder", true)).toBe(
      'cd /d "C:\\project folder" && echo ready',
    );
  });
});
