import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

import { AppSidebarResizeHandle } from "../AppSidebarResizeHandle";
import { useResizableAppSidebar } from "../../hooks/useResizableAppSidebar";

function ResizeHandleHarness() {
  const resize = useResizableAppSidebar(true);
  return (
    <AppSidebarResizeHandle
      handleProps={resize.handleProps}
      isResizing={resize.isResizing}
    />
  );
}

const readWorkspaceFile = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("AppSidebarResizeHandle", () => {
  it("exposes a restrained, keyboard-accessible vertical separator", () => {
    render(<ResizeHandleHarness />);
    const separator = screen.getByRole("separator", {
      name: "Resize navigation sidebar",
    });

    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "220");
    expect(separator).toHaveAttribute("aria-valuemax", "420");
    expect(separator).toHaveAttribute("aria-valuenow", "248");
    expect(separator).toHaveClass("hidden", "md:block", "w-[10px]");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "256");
  });

  it("integrates once in both desktop shells without changing mobile drawers", () => {
    const standard = readWorkspaceFile("app/components/ChatLayout.tsx");
    const pro = readWorkspaceFile("app/components/pro/ProChatLayout.tsx");
    const sidebar = readWorkspaceFile("app/components/Sidebar.tsx");

    for (const shell of [standard, pro]) {
      expect(shell.match(/<AppSidebarResizeHandle/g)).toHaveLength(1);
      expect(shell).toContain("isMobile === false && chatSidebarOpen");
      expect(shell).toContain("overflow-visible border-r");
      const mobileDrawer = shell.indexOf('role="dialog"');
      expect(mobileDrawer).toBeGreaterThan(-1);
      expect(shell.indexOf("<AppSidebarResizeHandle")).toBeLessThan(
        mobileDrawer,
      );
    }

    expect(standard).toContain("max-w-80");
    expect(pro).toContain("w-[min(88vw,320px)]");
    expect(sidebar).toContain('className={isMobile ? "w-full" : undefined}');
    expect(sidebar).not.toContain(
      'className={isMobile ? "w-full" : "w-[248px]"}',
    );
    expect(standard).not.toContain("data-mobile-sidebar-resizer");
    expect(pro).not.toContain("data-mobile-sidebar-resizer");
  });
});
