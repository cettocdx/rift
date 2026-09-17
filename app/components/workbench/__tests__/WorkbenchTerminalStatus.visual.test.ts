import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Workbench terminal status visual contract", () => {
  it("uses text hierarchy instead of decorative connection dots", () => {
    const terminal = readFileSync(
      join(
        process.cwd(),
        "app/components/workbench/WorkbenchInteractiveTerminal.tsx",
      ),
      "utf8",
    );
    const workbench = readFileSync(
      join(process.cwd(), "app/components/workbench/Workbench.tsx"),
      "utf8",
    );

    expect(terminal).toContain("data-terminal-connection-label");
    expect(terminal).not.toMatch(
      /data-terminal-connection-label[\s\S]{0,500}rounded-full/,
    );
    expect(workbench).toContain("data-workbench-cli-status");
    expect(workbench).not.toMatch(
      /data-workbench-cli-status[\s\S]{0,400}rounded-full/,
    );
  });

  it("keeps routine backend status hidden and real errors visible", () => {
    const panel = readFileSync(
      join(
        process.cwd(),
        "app/components/workbench/WorkbenchTerminalPanel.tsx",
      ),
      "utf8",
    );

    expect(panel).toContain("data-terminal-profile-status");
    expect(panel).toContain('profileCheck.status === "error"');
    expect(panel).toContain("text-workbench-error");
    expect(panel).not.toContain("xl:not-sr-only xl:max-w-28");
  });
});
