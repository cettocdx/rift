import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * These pages follow the workspace's own face rather than pinning the
 * platform's. Plugins, Tasks and every Codex-style page used to declare
 * -apple-system inline, so three product surfaces rendered in a different
 * typeface from the shell around them — and ignored the appearance setting
 * while they did it.
 */
export const CODEX_NATIVE_UI_STYLE: CSSProperties = Object.freeze({
  fontFamily:
    "var(--font-cursor-ui, var(--font-geist)), ui-sans-serif, system-ui, sans-serif",
});

type CodexPageShellProps = {
  children: ReactNode;
  className?: string;
  busy?: boolean;
};

type CodexPageHeaderProps = {
  title: string;
  description: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Shared page chrome for utility routes inside the desktop workbench.
 * It intentionally stays neutral so the active shell theme controls colour.
 */
export function CodexPageShell({
  children,
  className,
  busy,
}: CodexPageShellProps) {
  return (
    <div
      data-codex-page
      aria-busy={busy || undefined}
      className={cn(
        // `bg-background` already resolves to whatever the workspace theme
        // picked — true black under the OLED appearance. The hardcoded grey
        // that used to sit beside it always won in dark mode, which is why
        // Agents, Plugins, Tasks and Artifacts sat on #141414 while the rest of
        // the app was black.
        "terminal-scrollbar h-full min-h-0 overflow-y-auto bg-background",
        className,
      )}
      style={CODEX_NATIVE_UI_STYLE}
    >
      <div className="rift-page-frame rift-page-inset">{children}</div>
    </div>
  );
}

export function CodexPageHeader({
  title,
  description,
  leading,
  actions,
  className,
}: CodexPageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-3xl items-start gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="rift-page-title text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl rift-page-description text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export function CodexSectionHeading({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
      <h2 className="truncate rift-section-title text-foreground">
        {children}
      </h2>
      {meta ? (
        <span className="shrink-0 text-ui-caption text-muted-foreground/75">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

export function CodexEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center rounded-lg border border-border/80 bg-card/[0.12] px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-9 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground">
        {icon}
      </div>
      <h2 className="rift-section-title text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-sm text-ui leading-5 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
