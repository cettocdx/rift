import fs from "node:fs";
import path from "node:path";

describe("Hack Workbench product branding", () => {
  it("keeps provider selection internal while the UI presents the RIFT product", () => {
    const hackerMode = fs.readFileSync(
      path.join(process.cwd(), "app/components/HackerMode.tsx"),
      "utf8",
    );
    const hackRoute = fs.readFileSync(
      path.join(process.cwd(), "app/api/hack-chat/route.ts"),
      "utf8",
    );

    expect(hackerMode).not.toContain('"Grok 4.5"');
    expect(hackerMode).toContain('value: "RIFT"');
    expect(hackRoute).toContain("grok45Canary: true");
  });
});
