import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageManifest = {
  scripts?: Record<string, string>;
};

describe("local Workbench terminal development entrypoints", () => {
  it.each([
    "dev",
    "dev:local",
    "dev:next",
    "dev:cursor",
    "dev:workbench-preview",
    "dev:all",
  ])("enables the guarded local PTY in %s", (scriptName) => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as PackageManifest;
    const script = manifest.scripts?.[scriptName];

    expect(script).toContain("RIFT_LOCAL_TERMINAL=1");
    expect(script).toContain("RIFT_LOCAL_WORKSPACE_ROOT=$PWD");
  });

  it("keeps Tauri debug on the local-enabled Next entrypoint", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"),
    ) as { build?: { beforeDevCommand?: string } };

    expect(config.build?.beforeDevCommand).toBe("pnpm dev:next");
  });
});
