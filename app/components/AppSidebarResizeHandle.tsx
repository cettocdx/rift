"use client";

import { cn } from "@/lib/utils";
import type { useResizableAppSidebar } from "@/app/hooks/useResizableAppSidebar";

type AppSidebarResizeHandleProps = {
  handleProps: ReturnType<typeof useResizableAppSidebar>["handleProps"];
  isResizing: boolean;
};

/** A quiet Cursor-style hit area that reveals its hairline on interaction. */
export function AppSidebarResizeHandle({
  handleProps,
  isResizing,
}: AppSidebarResizeHandleProps) {
  return (
    <div
      {...handleProps}
      data-rift-sidebar-resizer
      data-resizing={isResizing ? "true" : "false"}
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-orientation="vertical"
      title="Drag to resize. Double-click to reset."
      className={cn(
        "group/resizer absolute inset-y-0 -right-[5px] z-30 hidden w-[10px] cursor-col-resize touch-none select-none md:block focus-visible:outline-none",
        "after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-150 after:content-['']",
        "hover:after:bg-sidebar-ring/55 focus-visible:after:bg-sidebar-ring motion-reduce:after:transition-none",
        isResizing && "after:bg-sidebar-ring",
      )}
    />
  );
}
