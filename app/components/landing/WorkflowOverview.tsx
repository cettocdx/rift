import { Braces, Eye, ListChecks, type LucideIcon } from "lucide-react";

import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";

type WorkflowStage = Readonly<{
  title: string;
  description: string;
  Icon: LucideIcon;
}>;

const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  {
    title: "Describe the work",
    description: "Add the goal, constraints, project context, and references.",
    Icon: ListChecks,
  },
  {
    title: "Inspect the execution",
    description:
      "Follow tool calls, commands, edits, and errors as structured events.",
    Icon: Eye,
  },
  {
    title: "Review the result",
    description: "Check changes, test evidence, previews, and remaining work.",
    Icon: Braces,
  },
] as const;

/** Honest, static overview of the product workflow. It does not simulate a run. */
export function WorkflowOverview() {
  return (
    <figure
      aria-label="RIFT workflow capability overview"
      className="overflow-hidden rounded-xl border border-white/10 bg-[#1b1e23] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <RiftPixelMark size={23} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-white/90">
              Workflow overview
            </p>
            <p className="truncate text-[10px] text-white/45">
              Capability map, not a live session
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-white/45">
          Non-interactive
        </span>
      </div>

      <div className="flex h-[264px] flex-col justify-center px-4 py-5 sm:h-[300px] sm:px-5">
        <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
          {WORKFLOW_STAGES.map(({ title, description, Icon }) => (
            <li
              key={title}
              className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.025] p-3.5"
            >
              <Icon
                aria-hidden="true"
                className="mb-3 size-4 text-[#00d3f5]"
                strokeWidth={1.6}
              />
              <h3 className="text-[12px] font-medium text-white/90">{title}</h3>
              <p className="mt-1.5 text-[11px] leading-[1.55] text-white/50">
                {description}
              </p>
            </li>
          ))}
        </ol>

        <figcaption className="mt-4 text-[10.5px] leading-relaxed text-white/40">
          This illustration explains the workflow. It does not execute commands
          or display generated results.
        </figcaption>
      </div>
    </figure>
  );
}
