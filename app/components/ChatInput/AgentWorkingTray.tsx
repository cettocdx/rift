"use client";

import { memo, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentActivitySubagent, SubagentStatus } from "../agent-activity";
import { OPEN_AGENT_ACTIVITY_EVENT } from "@/lib/workbench/events";
import { AgentActivityMark } from "@/components/ai-elements/activity-icon";
import styles from "./AgentWorkingTray.module.css";

const labels: Record<SubagentStatus, string> = {
  queued: "Queued",
  running: "Working",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  "not-approved": "Not approved",
  "awaiting-approval": "Awaiting approval",
};

/** The mobile dialog shares the desktop dock's exact invocation event. */
export function useMobileAgentActivity({
  enabled,
  onSelectAgent,
  onOpenActivity,
}: {
  enabled: boolean;
  onSelectAgent: (id: string | null) => void;
  onOpenActivity: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const open = (event: WindowEventMap[typeof OPEN_AGENT_ACTIVITY_EVENT]) => {
      onSelectAgent(event.detail?.toolCallId ?? null);
      onOpenActivity();
    };
    window.addEventListener(OPEN_AGENT_ACTIVITY_EVENT, open);
    return () => window.removeEventListener(OPEN_AGENT_ACTIVITY_EVENT, open);
  }, [enabled, onSelectAgent, onOpenActivity]);
}

export const AgentWorkingTray = memo(function AgentWorkingTray({
  agents,
  runKey,
  onSelectAgent,
}: {
  agents: readonly AgentActivitySubagent[];
  runKey: string;
  onSelectAgent: (id: string) => void;
}) {
  const id = useId();
  // Keep only this mounted run's preference, without storing transcript data.
  const [collapse, setCollapse] = useState({ runKey, collapsed: false });
  if (collapse.runKey !== runKey) {
    setCollapse({ runKey, collapsed: false });
  }
  const collapsed = collapse.runKey === runKey && collapse.collapsed;
  if (agents.length === 0) return null;
  const working = agents.filter((agent) => agent.status === "running").length;
  return (
    <section
      className={styles.tray}
      aria-label="Collaborators"
      data-ui="agent-working-tray"
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={!collapsed}
        aria-controls={`${id}-list`}
        onClick={() => setCollapse({ runKey, collapsed: !collapsed })}
      >
        {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
        <span>Collaborators</span>
        <span className={styles.count}>
          {working
            ? `${working} working`
            : `${agents.length} ${agents.length === 1 ? "collaborator" : "collaborators"}`}
        </span>
      </button>
      <ul id={`${id}-list`} className={styles.list} hidden={collapsed}>
        {agents.map((agent, index) => (
          <li key={agent.id}>
            <button
              type="button"
              className={styles.agent}
              onClick={() => onSelectAgent(agent.toolCallId ?? agent.id)}
              aria-describedby={`${id}-${index}-description`}
              title={`${agent.name}: ${agent.task}`}
            >
              <AgentActivityMark
                identity={agent.identity ?? agent.profileId ?? agent.id}
              />
              <span className={styles.label}>
                <span className={styles.name}>{agent.name}</span>
                <span className={styles.task}>{agent.task}</span>
              </span>
              <span className={styles.status}>{labels[agent.status]}</span>
              <ChevronRight aria-hidden />
            </button>
            <span
              className={styles.description}
              id={`${id}-${index}-description`}
            >
              {agent.summary || agent.error || agent.task}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
});
