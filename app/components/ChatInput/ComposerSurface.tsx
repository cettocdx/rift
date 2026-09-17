import type { ReactNode } from "react";

/** Shared sizing boundary for the input, goal and controls on every surface. */
export function ComposerSurface({
  isCentered = false,
  proShell = false,
  hasAttachments = false,
  children,
}: {
  isCentered?: boolean;
  proShell?: boolean;
  hasAttachments?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-ui="composer-shell"
      data-layout={isCentered ? "hero" : "follow-up"}
      className={`rift-composer order-2 flex max-h-[286px] min-w-0 flex-col overflow-hidden border border-border-strong bg-input-chat transition-[background-color,border-color,box-shadow] duration-150 sm:order-1 motion-reduce:transition-none ${
        isCentered ? "rounded-[16px]" : "rounded-[14px]"
      } ${proShell ? "pro-composer" : ""} ${hasAttachments ? "border-t-0" : ""}`}
    >
      <div data-ui="composer-frame" className="flex min-h-0 flex-col">
        {children}
      </div>
    </div>
  );
}
