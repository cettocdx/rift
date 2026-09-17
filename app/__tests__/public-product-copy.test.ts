import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("public product copy", () => {
  it("describes only the download formats that are actually offered", () => {
    const downloadPage = source("app/download/page.tsx");

    expect(downloadPage).toContain("macOS on Apple Silicon");
    expect(downloadPage).toContain("The Windows release is in progress.");
    expect(downloadPage).toContain(
      "On mobile, install RIFT from your browser.",
    );
    expect(downloadPage).not.toContain("Windows 64-bit");
    expect(downloadPage).not.toMatch(/Download RIFT for[^\n]*Linux/i);
    expect(downloadPage).not.toMatch(/penetration testing at your fingertips/i);
  });

  it("uses current product scope and credit terminology in public policies", () => {
    const privacy = source("app/privacy-policy/page.tsx");
    const refund = source("app/refund-policy/page.tsx");

    expect(privacy).not.toMatch(/\bbeta\b/i);
    expect(privacy).toContain("AI-assisted");
    expect(privacy).toContain("software development, media generation");
    expect(privacy).toContain("authorized security testing");
    expect(refund).not.toMatch(/\btokens?\b/i);
    expect(refund).toContain("usage credits");
    expect(refund).toContain("https://help.rift.co/en/");
    expect(refund).not.toContain("support@riftsys.app");
  });

  it("does not make an unsupported training claim in the landing FAQ", () => {
    const landing = source("app/components/landing/LandingPage.tsx");

    expect(landing).not.toContain("RIFT does not train on your projects");
    expect(landing).toContain(
      "See the Privacy Policy for current data-handling details.",
    );
  });
});
