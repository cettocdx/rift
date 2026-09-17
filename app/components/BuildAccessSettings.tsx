"use client";

import Link from "next/link";
import {
  AlertCircle,
  Container,
  FolderLock,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MonitorCog,
  PanelsTopLeft,
  Pencil,
  ShieldCheck,
  Unplug,
  type LucideIcon,
} from "lucide-react";

export interface BuildDesktopGrant {
  grantId: string;
  name: string;
  rootPath?: string;
  kind?: "directory" | "file";
  writable: boolean;
  grantedAt: number;
}

export type BuildDesktopAccessState =
  | "checking"
  | "ready"
  | "unavailable"
  | "error";

interface BuildAccessSettingsProps {
  localExecutionSelected?: boolean;
  desktopState: BuildDesktopAccessState;
  grants: readonly BuildDesktopGrant[];
  busyAction?: "read" | "write" | string | null;
  error?: string | null;
  onRequestAccess: (writable: boolean) => void;
  onRevokeAccess: (grantId: string) => void;
}

interface AccessRowProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status: string;
  statusTone?: "default" | "success" | "warning";
}

function AccessRow({
  icon: Icon,
  title,
  description,
  status,
  statusTone = "default",
}: AccessRowProps) {
  return (
    <li className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5 sm:items-center">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-background text-muted-foreground">
          <Icon className="size-3.5" aria-hidden strokeWidth={1.7} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block text-[10.5px] leading-4 text-[var(--cursor-text-secondary)]">
            {description}
          </span>
        </span>
      </div>
      <span
        className={`pt-1 text-right text-[10.5px] font-medium sm:pt-0 ${
          statusTone === "success"
            ? "text-success"
            : statusTone === "warning"
              ? "text-warning"
              : "text-muted-foreground"
        }`}
      >
        {status}
      </span>
    </li>
  );
}

export function BuildAccessSessionIndicator({
  desktopState,
  grantCount,
}: {
  desktopState: BuildDesktopAccessState;
  grantCount: number;
}) {
  // One word when there is nothing to report. "Computer not shared" spent three
  // words stating a default; the row reads as scope, not as status, so the
  // quiet case is just the noun. A real grant still names itself, because a
  // shared folder is a fact the operator needs to see.
  const localLabel =
    desktopState === "checking"
      ? "Checking computer"
      : grantCount > 0
        ? `${grantCount} item${grantCount === 1 ? "" : "s"} shared`
        : "Computer";

  return (
    <div
      data-ui="build-access-session-indicator"
      role="status"
      aria-live="polite"
      className="flex min-h-8 items-center gap-x-3 overflow-hidden border-b border-border/70 px-3 py-1.5 text-[10.5px] font-medium text-muted-foreground"
    >
      {/* The icon already says which scope this is; the word only has to name
          it. "Public web" and "Sandbox localhost" repeated in the label what
          the row's own heading and glyph establish. */}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[var(--cursor-text-secondary)]">
        <Globe2 className="size-3" aria-hidden strokeWidth={1.7} />
        Web
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Container className="size-3" aria-hidden strokeWidth={1.7} />
        Sandbox
      </span>
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap ${
          grantCount > 0 ? "text-success" : ""
        }`}
      >
        <MonitorCog className="size-3" aria-hidden strokeWidth={1.7} />
        {localLabel}
      </span>
    </div>
  );
}

export function BuildAccessSettings({
  localExecutionSelected = false,
  desktopState,
  grants,
  busyAction = null,
  error = null,
  onRequestAccess,
  onRevokeAccess,
}: BuildAccessSettingsProps) {
  const active = grants.length > 0;
  const sessionLabel = active
    ? `${grants.length} item${grants.length === 1 ? "" : "s"} shared`
    : desktopState === "checking"
      ? "Checking session"
      : "No files shared";

  return (
    <div className="space-y-4 py-3">
      <div>
        <h3 className="text-[13px] font-medium text-foreground">
          Build access
        </h3>
        <p className="mt-1 max-w-[62ch] text-[11px] leading-4 text-muted-foreground">
          Choose where Build executes. Browser control and picker access use
          separate, scoped connections.
        </p>
      </div>

      <section
        aria-labelledby="build-access-capabilities"
        className="overflow-hidden rounded-[10px] border border-border bg-surface-1"
      >
        <div className="flex min-h-12 items-center gap-2.5 border-b border-border px-3 py-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-background ${
              active ? "text-success" : "text-muted-foreground"
            }`}
          >
            <ShieldCheck className="size-3.5" aria-hidden strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <h4
              id="build-access-capabilities"
              className="text-[12px] font-medium text-foreground"
            >
              Current Build session
            </h4>
            <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
              Local grants expire when you quit the desktop app.
            </p>
          </div>
          <span
            role="status"
            aria-live="polite"
            className={`shrink-0 text-[10.5px] font-medium ${
              active ? "text-success" : "text-muted-foreground"
            }`}
          >
            {sessionLabel}
          </span>
        </div>

        <ul className="divide-y divide-border/70">
          <AccessRow
            icon={Globe2}
            title="Public web"
            description="Read public HTTPS pages with redirects and destinations revalidated."
            status="Available"
            statusTone="success"
          />
          <AccessRow
            icon={Container}
            title="Build localhost"
            description={
              localExecutionSelected
                ? "localhost points to the selected local runner’s computer."
                : "localhost points to this Build’s isolated cloud sandbox."
            }
            status={localExecutionSelected ? "Selected runner" : "Sandbox only"}
          />
          <AccessRow
            icon={PanelsTopLeft}
            title="Browser interaction"
            description="Use Computer control above for your Mac, or connect a Browser MCP for an isolated browser session."
            status="Approval required"
            statusTone="warning"
          />
          <AccessRow
            icon={FolderLock}
            title="Selected files"
            description="Picker access covers only the files and folders you choose. A connected local runner has separate command access."
            status={
              active
                ? "Session active"
                : desktopState === "unavailable"
                  ? "Desktop only"
                  : "Not shared"
            }
            statusTone={active ? "success" : "default"}
          />
        </ul>
      </section>

      <section
        aria-labelledby="local-computer-access-heading"
        className="overflow-hidden rounded-[10px] border border-border bg-surface-1"
      >
        <div className="border-b border-border px-3 py-2.5">
          <h4
            id="local-computer-access-heading"
            className="text-[12px] font-medium text-foreground"
          >
            Local file and folder access
          </h4>
          <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
            A message alone never grants access. Every item is selected in the
            native dialog. Files opened from the composer can be edited; folders
            have separate read and write permissions.
          </p>
        </div>

        {desktopState === "checking" ? (
          <div
            role="status"
            className="flex min-h-20 items-center gap-2.5 px-3 text-[11px] text-muted-foreground"
          >
            <LoaderCircle
              className="size-3.5 motion-safe:animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            Checking desktop session access...
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex min-h-20 items-start gap-2.5 px-3 py-3 text-[11px] leading-4 text-destructive"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : grants.length > 0 ? (
          <ul className="divide-y divide-border/70">
            {grants.map((grant) => (
              <li
                key={grant.grantId}
                className="flex flex-col gap-2.5 px-3 py-2.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-background text-muted-foreground">
                    <FolderOpen
                      className="size-3.5"
                      aria-hidden
                      strokeWidth={1.7}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12px] font-medium text-foreground">
                        {grant.name}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                        {grant.writable ? "Read and write" : "Read only"}
                      </span>
                    </div>
                    <p
                      className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground"
                      title={grant.rootPath}
                    >
                      {grant.kind === "file"
                        ? "Selected file only"
                        : grant.rootPath}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyAction === grant.grantId}
                  onClick={() => onRevokeAccess(grant.grantId)}
                  className="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 self-stretch rounded-[6px] border border-border px-2.5 text-[10.5px] font-medium text-[var(--cursor-text-secondary)] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:h-8 sm:self-auto"
                >
                  {busyAction === grant.grantId ? (
                    <LoaderCircle
                      className="size-3 motion-safe:animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : (
                    <Unplug className="size-3" aria-hidden strokeWidth={1.7} />
                  )}
                  Stop sharing
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-3 py-3">
            <div className="flex items-start gap-2.5">
              <FolderLock
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
                strokeWidth={1.7}
              />
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  No files or folders are shared
                </p>
                <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
                  Open a file in the composer or choose a folder here to work on
                  your computer.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-4 text-muted-foreground">
            {desktopState === "unavailable"
              ? "Install or open RIFT Desktop to share a local folder."
              : "Choose the smallest folder and access level needed for this Build."}
          </p>
          {desktopState === "unavailable" ? (
            <Link
              href="/download"
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-background px-3 text-[10.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none motion-reduce:transition-none sm:h-8"
            >
              Get desktop app
            </Link>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:flex">
              <button
                type="button"
                disabled={desktopState !== "ready" || busyAction !== null}
                onClick={() => onRequestAccess(false)}
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border border-border bg-background px-3 text-[10.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:h-8"
              >
                {busyAction === "read" ? (
                  <LoaderCircle
                    className="size-3 motion-safe:animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <FolderOpen
                    className="size-3"
                    aria-hidden
                    strokeWidth={1.7}
                  />
                )}
                Share read only
              </button>
              <button
                type="button"
                disabled={desktopState !== "ready" || busyAction !== null}
                onClick={() => onRequestAccess(true)}
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] bg-foreground px-3 text-[10.5px] font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:h-8"
              >
                {busyAction === "write" ? (
                  <LoaderCircle
                    className="size-3 motion-safe:animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <Pencil className="size-3" aria-hidden strokeWidth={1.7} />
                )}
                Share with write access
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
