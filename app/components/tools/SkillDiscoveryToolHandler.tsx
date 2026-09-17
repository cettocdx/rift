import { Check, LoaderCircle, Search, X } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ChatStatus } from "@/types/chat";

type DiscoveredSkill = {
  id?: string;
  name?: string;
  reason?: string;
};

type FindSkillsOutput = {
  matched?: boolean;
  count?: number;
  /** The single full copy of every loaded pack; sibling groupings are id-only. */
  activeSkills?: DiscoveredSkill[];
  installation?: {
    status?: "installed" | "loaded" | "partial";
    failed?: Array<{ catalogId?: string; reason?: string }>;
  };
};

export function SkillDiscoveryToolHandler({
  part,
  status,
}: {
  part: {
    state?: string;
    output?: FindSkillsOutput;
    errorText?: string;
  };
  status: ChatStatus;
}) {
  const isComplete = part.state === "output-available";
  const isError = part.state === "output-error";
  const isRunning = !isComplete && !isError && status === "streaming";
  const activeSkills = Array.isArray(part.output?.activeSkills)
    ? part.output.activeSkills
    : [];
  const skills = Array.from(
    new Map(
      activeSkills.map((skill) => [skill.id ?? skill.name, skill]),
    ).values(),
  );
  const count =
    skills.length > 0
      ? skills.length
      : typeof part.output?.count === "number"
        ? part.output.count
        : 0;
  const failedInstallations = Array.isArray(part.output?.installation?.failed)
    ? part.output.installation.failed.length
    : 0;

  // Loading playbooks is automatic, so the transcript states only that it
  // happened — never which packs. Naming them turned routine plumbing into a
  // wall of jargon the reader was invited to evaluate.
  const detail = isError
    ? part.errorText || "Could not inspect the skill catalog"
    : isRunning
      ? "Loading skills"
      : count > 0
        ? `Loaded ${count} skill${count === 1 ? "" : "s"}${
            failedInstallations > 0
              ? ` · ${failedInstallations} persistence warning${failedInstallations === 1 ? "" : "s"}`
              : ""
          }`
        : isComplete
          ? "No extra skills needed"
          : "Discovery did not complete";
  const stateLabel = isError
    ? "Unavailable"
    : isRunning
      ? "Checking"
      : isComplete && count > 0
        ? `${count} loaded`
        : "Complete";

  return (
    <div
      data-ui="skill-discovery"
      data-state={isError ? "error" : isRunning ? "running" : "complete"}
      role="status"
      aria-live="polite"
      className="not-prose my-0 flex min-h-[30px] min-w-0 items-center gap-1.5 bg-transparent px-0.5 py-1.5"
    >
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/65"
      >
        <Search className="size-3.5" strokeWidth={1.7} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
        <span className="shrink-0 text-[12px] text-[var(--cursor-text-secondary)]">
          Project skills
        </span>
        <span
          className="truncate font-mono text-[11.5px] text-muted-foreground/70"
          title={detail}
        >
          {isRunning ? <Shimmer>{detail}</Shimmer> : detail}
        </span>
      </span>
      <span
        className={`flex size-4 shrink-0 items-center justify-center ${
          isError
            ? "text-destructive"
            : isComplete
              ? "text-[var(--success)]"
              : "text-muted-foreground"
        }`}
      >
        {isError ? (
          <X className="size-3" aria-hidden="true" />
        ) : isRunning ? (
          <LoaderCircle
            className="size-3 motion-safe:animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Check className="size-3" aria-hidden="true" />
        )}
        <span className="sr-only">{stateLabel}</span>
      </span>
    </div>
  );
}

export default SkillDiscoveryToolHandler;
