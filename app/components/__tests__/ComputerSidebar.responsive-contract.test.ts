import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ComputerSidebar responsive shell", () => {
  it("becomes an in-layout side pane at the same 768px threshold as auto-open", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ComputerSidebar.tsx"),
      "utf8",
    );
    const shellClass = source.match(
      /data-computer-sidebar[\s\S]*?className="([^"]+)"/,
    )?.[1];

    expect(shellClass).toContain("fixed");
    expect(shellClass).toContain("md:relative");
    expect(shellClass).not.toContain("desktop:relative");
  });
});
