import {
  Braces,
  FileStack,
  FolderGit2,
  Image as ImageIcon,
  ListChecks,
  Paperclip,
  PanelsTopLeft,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";

type CapabilityItem = Readonly<{
  label: string;
  Icon: LucideIcon;
}>;

const CONTEXT_ITEMS: readonly CapabilityItem[] = [
  { label: "Repository context", Icon: FolderGit2 },
  { label: "Task requirements", Icon: ListChecks },
  { label: "Files and references", Icon: Paperclip },
] as const;

const REVIEW_ITEMS: readonly CapabilityItem[] = [
  { label: "Code changes", Icon: Braces },
  { label: "Test evidence", Icon: ShieldCheck },
  { label: "Previews and artifacts", Icon: ImageIcon },
] as const;

const WORKSPACE_CAPABILITIES = [
  "Plan with project context",
  "Run tools with visible activity",
  "Review before continuing",
] as const;

export interface CapabilityFlowProps {
  variant?: "default" | "embedded" | "hero";
}

function CapabilityList({
  title,
  items,
}: {
  title: string;
  items: readonly CapabilityItem[];
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-1/70 p-3">
      <h3 className="text-[10px] font-medium text-muted-foreground">{title}</h3>
      <ul className="mt-2.5 space-y-2.5">
        {items.map(({ label, Icon }) => (
          <li key={label} className="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-signal"
              strokeWidth={1.6}
            />
            <span className="truncate text-[11px] text-foreground/75">
              {label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Static capability map. It deliberately avoids product chrome and fake output. */
export function CapabilityFlow({ variant = "default" }: CapabilityFlowProps) {
  const shellClass =
    variant === "embedded"
      ? "h-[400px] sm:h-[440px]"
      : variant === "hero"
        ? "h-full min-h-[360px] sm:min-h-[420px] lg:min-h-0"
        : "min-h-[360px] sm:min-h-[400px]";

  return (
    <figure
      aria-label="RIFT static capability map"
      className={`relative mx-auto flex w-full max-w-none flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-2 text-left shadow-[0_40px_120px_-30px_rgba(0,0,0,0.7)] ${shellClass}`}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-surface-1 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <RiftPixelMark size={23} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-foreground">
              RIFT capability map
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              Context, execution, and review in one workspace
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
          Static overview
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-2.5 p-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)] sm:gap-3 sm:p-4">
        <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <section className="flex h-full min-w-0 flex-col rounded-lg border border-signal/20 bg-signal/[0.055] p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-signal/20 bg-background/35">
                <PanelsTopLeft
                  aria-hidden="true"
                  className="size-4 text-signal"
                  strokeWidth={1.6}
                />
              </span>
              <div className="min-w-0">
                <h3 className="text-[12px] font-medium text-foreground">
                  Agent workspace
                </h3>
                <p className="text-[10.5px] text-muted-foreground">
                  One continuous task context
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-2 border-t border-signal/15 pt-3">
              {WORKSPACE_CAPABILITIES.map((capability) => (
                <li
                  key={capability}
                  className="flex items-center gap-2 text-[10.5px] leading-4 text-foreground/70"
                >
                  <FileStack
                    aria-hidden="true"
                    className="size-3 shrink-0 text-signal"
                    strokeWidth={1.6}
                  />
                  {capability}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="sm:col-start-1 sm:row-start-1">
          <CapabilityList title="Inputs" items={CONTEXT_ITEMS} />
        </div>
        <div className="sm:col-start-3 sm:row-start-1">
          <CapabilityList title="Review surfaces" items={REVIEW_ITEMS} />
        </div>
      </div>

      <figcaption className="border-t border-border px-3.5 py-2 text-[10px] leading-4 text-muted-foreground">
        Illustrated capability map. It is not a live session, terminal, or
        result feed.
      </figcaption>
    </figure>
  );
}
