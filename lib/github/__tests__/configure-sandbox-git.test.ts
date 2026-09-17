import { configureSandboxGit } from "@/lib/github/configure-sandbox-git";
import type { AnySandbox } from "@/types";

describe("configureSandboxGit", () => {
  it("keeps E2B agent credentials in root's private home", async () => {
    const run = jest.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const sandbox = { commands: { run } } as unknown as AnySandbox;

    await configureSandboxGit(sandbox, "github-secret-token", "Rift Developer");

    expect(run).toHaveBeenCalledTimes(1);
    const [command, options] = run.mock.calls[0];
    expect(command).not.toContain("github-secret-token");
    expect(command).toContain('"$HOME/.git-credentials"');
    expect(options).toEqual(
      expect.objectContaining({
        user: "root",
        cwd: "/root",
        envs: {
          GH_TOKEN: "github-secret-token",
          HOME: "/root",
        },
      }),
    );
    expect(options).not.toHaveProperty("envVars");
  });

  it("preserves the common envVars adapter for local sandboxes", async () => {
    const run = jest.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const sandbox = {
      sandboxKind: "centrifugo",
      commands: { run },
    } as unknown as AnySandbox;

    await configureSandboxGit(sandbox, "local-token");

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ envVars: { GH_TOKEN: "local-token" } }),
    );
  });
});
