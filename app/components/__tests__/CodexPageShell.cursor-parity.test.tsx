import { render, screen } from "@testing-library/react";

import { CodexPageHeader, CodexPageShell } from "../page-shell/CodexPageShell";

describe("Codex utility page shell", () => {
  it("keeps the Cursor-density content well and native system typography", () => {
    const { container } = render(
      <CodexPageShell>
        <CodexPageHeader
          title="Customize"
          description="Manage the tools available to agents."
        />
      </CodexPageShell>,
    );

    const shell = container.querySelector<HTMLElement>("[data-codex-page]");
    expect(shell).not.toBeNull();
    // The shell follows the workspace theme rather than pinning a grey: under
    // the OLED appearance these pages have to be as black as the rest of the app.
    expect(shell).toHaveClass("bg-background");
    expect(shell).not.toHaveClass("dark:bg-[#141414]");
    // The shell follows the workspace's face too, rather than pinning the
    // platform font and ignoring the appearance setting.
    expect(shell?.style.fontFamily).toContain("--font-cursor-ui");

    const contentWell = shell?.firstElementChild;
    expect(contentWell).toHaveClass("rift-page-frame", "rift-page-inset");
    expect(screen.getByRole("heading", { name: "Customize" })).toHaveClass(
      "rift-page-title",
    );
  });
});
