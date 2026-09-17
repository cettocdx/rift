import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { getSourceHost, SourceDomainBadge } from "../SourceDomainBadge";

describe("SourceDomainBadge", () => {
  it("normalizes a source host and exposes an accessible local mark", () => {
    const { container } = render(
      <SourceDomainBadge source="https://www.example.com/research?id=7" />,
    );

    expect(
      screen.getByRole("img", { name: "example.com source" }),
    ).toHaveTextContent("E");
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps malformed source strings deterministic", () => {
    expect(getSourceHost("docs.example.test/path/to/page")).toBe(
      "docs.example.test",
    );
    expect(getSourceHost(" ")).toBe("source");
  });

  it("keeps citation surfaces free of third-party favicon services", () => {
    for (const relativePath of [
      "app/components/SourcesDialog.tsx",
      "app/components/MessageActions.tsx",
      "app/components/ComputerSidebar.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toContain("SourceDomainBadge");
      expect(source).not.toMatch(
        /google(?:usercontent)?\.com\/s2|s2\.googleusercontent\.com|favicons\?domain/i,
      );
    }
  });
});
