import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ATOMIC_SAVE_COMMAND,
  LIST_DIRECTORY_COMMAND,
  PREPARE_WORKBENCH_STATE_COMMAND,
  READ_FILE_COMMAND,
  VERIFY_DIRECTORY_COMMAND,
} from "@/lib/workbench/sandbox-fs-commands";

function revision(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function run(command: string, envs: Record<string, string>) {
  return spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, ...envs },
  });
}

describe("Workbench sandbox filesystem commands", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rift-workbench-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "app.ts"), "export const value = 1;\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists bounded regular entries without following symlinks", () => {
    symlinkSync(tmpdir(), join(root, "outside"));
    const result = run(LIST_DIRECTORY_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "",
      RIFT_SCAN_LIMIT: "20",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      entries: [expect.objectContaining({ name: "src", type: "directory" })],
      sourceTruncated: false,
    });
    expect(result.stdout).not.toContain("outside");
  });

  it("reads a regular file through no-follow descriptors", () => {
    const result = run(READ_FILE_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "src/app.ts",
      RIFT_MAX_BYTES: "1024",
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: string; size: number };
    expect(Buffer.from(payload.data, "base64").toString("utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(payload.size).toBe(24);
  });

  it("rejects a read when the opened file changes in place", () => {
    const filePath = join(root, "src", "changing.txt");
    writeFileSync(filePath, Buffer.alloc(64 * 1024, "a"));
    // Inject a real write after the first descriptor read. The production
    // command and its fstat checks stay unchanged; no scheduler race, sleeps,
    // unbounded mutator process, or multi-megabyte stdout buffer is required.
    writeFileSync(
      join(root, "sitecustomize.py"),
      `import os
original_read=os.read
changed=False
def read_then_change(fd,length):
    global changed
    data=original_read(fd,length)
    path=os.path.join(os.environ["RIFT_ROOT"],os.environ["RIFT_RELATIVE"])
    opened=os.fstat(fd)
    target=os.stat(path)
    if data and not changed and (opened.st_dev,opened.st_ino)==(target.st_dev,target.st_ino):
        changed=True
        writer=os.open(path,os.O_WRONLY)
        try:
            os.pwrite(writer,b"b",0)
            os.utime(writer,ns=(opened.st_atime_ns,opened.st_mtime_ns+1000000000))
        finally:
            os.close(writer)
    return data
os.read=read_then_change
`,
    );
    const result = run(READ_FILE_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "src/changing.txt",
      RIFT_MAX_BYTES: String(128 * 1024),
      PYTHONPATH: root,
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(readFileSync(filePath)[0]).toBe("b".charCodeAt(0));
    expect(result.status).toBe(47);
  });

  it("rejects directory traversal through a symlink", () => {
    symlinkSync(tmpdir(), join(root, "outside"));
    const result = run(VERIFY_DIRECTORY_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "outside",
    });

    expect(result.status).toBe(41);
  });

  it("saves only when the expected revision still matches", () => {
    const stateRoot = join(root, ".rift-workbench-state");
    expect(
      run(PREPARE_WORKBENCH_STATE_COMMAND, { RIFT_HOME: root }).status,
    ).toBe(0);

    const firstTempName = "first-save";
    const firstContent = "export const value = 2;\n";
    writeFileSync(join(stateRoot, "tmp", firstTempName), firstContent);
    const firstSave = run(ATOMIC_SAVE_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "src/app.ts",
      RIFT_STATE_ROOT: stateRoot,
      RIFT_TEMP_NAME: firstTempName,
      RIFT_EXPECTED_REVISION: revision("export const value = 1;\n"),
      RIFT_NEXT_REVISION: revision(firstContent),
      RIFT_MAX_BYTES: "1024",
    });

    expect(firstSave.status).toBe(0);
    expect(readFileSync(join(root, "src", "app.ts"), "utf8")).toBe(
      firstContent,
    );

    const staleTempName = "stale-save";
    const staleContent = "export const value = 3;\n";
    writeFileSync(join(stateRoot, "tmp", staleTempName), staleContent);
    const staleSave = run(ATOMIC_SAVE_COMMAND, {
      RIFT_ROOT: root,
      RIFT_RELATIVE: "src/app.ts",
      RIFT_STATE_ROOT: stateRoot,
      RIFT_TEMP_NAME: staleTempName,
      RIFT_EXPECTED_REVISION: revision("export const value = 1;\n"),
      RIFT_NEXT_REVISION: revision(staleContent),
      RIFT_MAX_BYTES: "1024",
    });

    expect(staleSave.status).toBe(42);
    expect(staleSave.stdout.trim()).toBe(revision(firstContent));
    expect(readFileSync(join(root, "src", "app.ts"), "utf8")).toBe(
      firstContent,
    );
  });
});
