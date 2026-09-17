import {
  BookOpen,
  FilePenLine,
  Globe2,
  Images,
  Monitor,
  ListChecks,
  Search,
  Shapes,
  Terminal,
  Wrench,
} from "lucide-react";
import type { TranscriptToolCategory } from "@/lib/chat/transcript-presentation";

const operationIcons = {
  desktop: Monitor,
  read: BookOpen,
  image: Images,
  edit: FilePenLine,
  command: Terminal,
  search: Search,
  web: Globe2,
  plan: ListChecks,
  skill: Shapes,
  tool: Wrench,
};

/** A stable, small identity mark for a real delegated agent, independent of its
 * current status. Color distinguishes identities; text always names the agent. */
export function AgentActivityMark({ identity }: { identity: string }) {
  let hash = 2166136261;
  for (const character of identity)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const tone = hash % 3;
  const variant = (hash >>> 8) % 3;
  return (
    <svg
      aria-hidden="true"
      data-ui="agent-activity-mark"
      data-tone={tone === 0 ? "violet" : tone === 1 ? "rose" : "iris"}
      className="rift-activity-icon rift-agent-mark"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {variant === 0 ? (
        <>
          <circle cx="10" cy="10" r="7" />
          <ellipse cx="10" cy="10" rx="3" ry="7" />
          <path d="M3 10h14" />
        </>
      ) : variant === 1 ? (
        <>
          <path d="M10 9C4 10 3 6 5 4s6-1 5 5ZM11 10c-1-6 3-7 5-5s1 6-5 5ZM10 11c6-1 7 3 5 5s-6 1-5-5ZM9 10c1 6-3 7-5 5s-1-6 5-5Z" />
          <circle cx="10" cy="10" r="1" />
        </>
      ) : (
        <>
          <path d="m10 2 3 3-3 3-3-3 3-3Zm0 10 3 3-3 3-3-3 3-3ZM2 10l3-3 3 3-3 3-3-3Zm10 0 3-3 3 3-3 3-3-3Z" />
        </>
      )}
    </svg>
  );
}

export function ActivityIcon({
  category,
}: {
  category: TranscriptToolCategory;
}) {
  if (category === "agent") return <AgentActivityMark identity="agent" />;
  const Icon = operationIcons[category];
  return (
    <Icon
      aria-hidden="true"
      data-ui="activity-operation-icon"
      data-operation={category}
      className="rift-activity-icon"
      size={14}
      strokeWidth={1.5}
    />
  );
}
